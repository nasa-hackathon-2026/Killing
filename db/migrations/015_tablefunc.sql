-- tablefunc（#91）：用 crosstab 產生探勘的輸入寬表「地點 × 月份」一列、每個變數一欄，
-- 和 mining.py 的 build_table（pandas／numpy）是同一張表，用來互相核對。
CREATE EXTENSION IF NOT EXISTS tablefunc;

-- 寬表裡的序列（長表）：核心快照、補值後的距平、符合探勘條件、趨勢統計有分析的序列。
-- 點位表用 aggregation = 'point'，區域表用 'area_mean'（與 mining.TABLE_AGGREGATION 相同）。
CREATE OR REPLACE VIEW analysis.mining_wide_source AS
SELECT CASE s.aggregation WHEN 'point' THEN 'point' ELSE 'region' END AS table_kind,
       s.series_id, s.location_id, s.variable_id, o.month, o.anomaly_filled
FROM meta.series s
JOIN clean.series_summary q USING (series_id)
JOIN clean.observations o USING (series_id)
LEFT JOIN analysis.trends t USING (series_id)
WHERE s.tier = 'core'
  AND s.aggregation IN ('point', 'area_mean')
  AND q.mining_eligible
  AND coalesce(t.status, 'analyzed') = 'analyzed'
  AND o.month BETWEEN q.first_usable_month AND q.last_usable_month;

-- 重建 analysis.mining_wide_point 或 analysis.mining_wide_region。期間是表內所有序列共同有
-- 資料的起訖月；欄位隨變數而定，所以用動態 SQL 組 crosstab 的欄位清單。回傳列數。
CREATE OR REPLACE FUNCTION analysis.build_mining_wide(
    p_kind text, p_exclude_locations text[] DEFAULT ARRAY['taiwan'])
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    first_month date;
    last_month date;
    columns text;
    source_sql text;
    category_sql text;
    target text := format('analysis.%I', 'mining_wide_' || p_kind);
    n integer;
BEGIN
    IF p_kind NOT IN ('point', 'region') THEN
        RAISE EXCEPTION 'p_kind must be point or region';
    END IF;
    SELECT max(lo), min(hi) INTO first_month, last_month
    FROM (
        SELECT min(m.month) AS lo, max(m.month) AS hi
        FROM analysis.mining_wide_source m
        WHERE m.table_kind = p_kind AND m.location_id <> ALL (p_exclude_locations)
        GROUP BY m.series_id
    ) spans;
    EXECUTE format('DROP TABLE IF EXISTS %s', target);
    IF first_month IS NULL OR last_month < first_month THEN
        RETURN 0;
    END IF;
    SELECT string_agg(format('%I double precision', variable_id), ', ' ORDER BY variable_id)
    INTO columns
    FROM (
        SELECT DISTINCT m.variable_id FROM analysis.mining_wide_source m
        WHERE m.table_kind = p_kind AND m.location_id <> ALL (p_exclude_locations)
    ) v;
    source_sql := format(
        'SELECT location_id || %L || month, location_id, month, variable_id, anomaly_filled'
        ' FROM analysis.mining_wide_source'
        ' WHERE table_kind = %L AND location_id <> ALL (%L::text[]) AND month BETWEEN %L AND %L'
        ' ORDER BY 1, 4',
        '|', p_kind, p_exclude_locations, first_month, last_month);
    category_sql := format(
        'SELECT DISTINCT variable_id FROM analysis.mining_wide_source'
        ' WHERE table_kind = %L AND location_id <> ALL (%L::text[]) ORDER BY 1',
        p_kind, p_exclude_locations);
    EXECUTE format(
        'CREATE TABLE %s AS SELECT location_id, month, %s FROM crosstab(%L, %L)'
        ' AS ct (row_key text, location_id text, month date, %s)',
        target,
        (SELECT string_agg(format('%I', variable_id), ', ' ORDER BY variable_id)
         FROM (SELECT DISTINCT m.variable_id FROM analysis.mining_wide_source m
               WHERE m.table_kind = p_kind AND m.location_id <> ALL (p_exclude_locations)) v),
        source_sql, category_sql, columns);
    EXECUTE format('ALTER TABLE %s ADD PRIMARY KEY (location_id, month)', target);
    EXECUTE format('SELECT count(*) FROM %s', target) INTO n;
    RETURN n;
END $$;
