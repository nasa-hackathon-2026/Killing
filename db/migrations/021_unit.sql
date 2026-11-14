-- unit（#91；postgresql-unit，SI 單位）：顯示用的單位換算，數值本身不改。
-- 支援的換算（其他組合回 NULL）：
--   K → degC（絕對溫度，減 273.15）；degC／C → K
--   kg m-2 s-1 → mm/day（水的通量：除以水的密度 1000 kg m⁻³，1 kg m⁻² = 1 mm 水深）
--   mm/hr → mm/day；Pa → hPa
-- 趨勢斜率這類「差值」的 K 與 °C 相同，不要用這個函式換。
CREATE EXTENSION IF NOT EXISTS unit;

CREATE OR REPLACE FUNCTION meta.convert_unit(
    p_value double precision, p_from text, p_to text)
RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN p_from = 'K' AND p_to = 'degC'
            THEN (p_value * '1 K'::unit) @@ 'degC'
        WHEN p_from IN ('degC', 'C') AND p_to = 'K'
            THEN (p_value::text || ' degC')::unit @@ 'K'
        WHEN p_from = 'kg m-2 s-1' AND p_to = 'mm/day'
            THEN (p_value * '1 kg/m^2/s'::unit / '1000 kg/m^3'::unit) @@ 'mm/d'
        WHEN p_from = 'mm/hr' AND p_to = 'mm/day'
            THEN (p_value * '1 mm/hr'::unit) @@ 'mm/d'
        WHEN p_from = 'Pa' AND p_to = 'hPa'
            THEN (p_value * '1 Pa'::unit) @@ 'hPa'
    END;
$$;

-- 各變數顯示用的單位（只列有換算的）
CREATE OR REPLACE VIEW meta.display_units AS
SELECT v.id AS variable_id, v.unit,
       CASE v.unit WHEN 'K' THEN 'degC' WHEN 'kg m-2 s-1' THEN 'mm/day'
                   WHEN 'mm/hr' THEN 'mm/day' WHEN 'Pa' THEN 'hPa' END AS display_unit
FROM meta.variables v
WHERE v.unit IN ('K', 'kg m-2 s-1', 'mm/hr', 'Pa');
