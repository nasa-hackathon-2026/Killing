-- H3（#91）：統一的六角網格索引，讓不同網格的產品能在同一套格子上並排。
-- 解析度 3：平均每格約 12,393 km²，和赤道上的 1° × 1° 格（約 12,364 km²）同一個量級，
-- 所以是「不比資料細」的最細一層；解析度 2（約 86,802 km²，是 7 個 res 3 格）每格約含 7 個
-- 1° 格，給比較穩定的彙整。面積是 H3 的全球平均；實際每格面積用 h3_cell_area(h3, 'km^2')。
CREATE EXTENSION IF NOT EXISTS h3;
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;

ALTER TABLE geo.locations ADD COLUMN IF NOT EXISTS h3_res3 h3index
    GENERATED ALWAYS AS (h3_latlng_to_cell(geom, 3)) STORED;
ALTER TABLE geo.grid_cells ADD COLUMN IF NOT EXISTS h3_res3 h3index
    GENERATED ALWAYS AS (h3_latlng_to_cell(centre, 3)) STORED;
CREATE INDEX IF NOT EXISTS grid_cells_h3 ON geo.grid_cells (h3_res3, variable_id);

-- 各變數的趨勢格點彙整到 H3 格（解析度 2 與 3）：格子中心落在哪個六角格就算哪一格，
-- 平均斜率與顯著比例都用格子面積加權。由 `pg load` 重新整理。
CREATE MATERIALIZED VIEW IF NOT EXISTS geo.h3_trends AS
SELECT r.resolution,
       h3_cell_to_parent(c.h3_res3, r.resolution) AS h3,
       c.variable_id,
       count(*) AS n_cells,
       sum(c.area_km2) AS analysed_area_km2,
       sum(c.slope_per_decade * c.area_km2) / sum(c.area_km2) AS mean_slope_per_decade,
       coalesce(sum(c.area_km2) FILTER (WHERE c.significance = 3), 0) / sum(c.area_km2)
           AS significant_fdr_area_fraction
FROM geo.grid_cells c
CROSS JOIN (VALUES (2), (3)) AS r (resolution)
GROUP BY r.resolution, h3_cell_to_parent(c.h3_res3, r.resolution), c.variable_id
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS h3_trends_key ON geo.h3_trends (resolution, h3, variable_id);

-- 同一格上各變數並排：一列一個 H3 格，slopes 是 {變數: 平均斜率}
CREATE OR REPLACE VIEW geo.h3_trends_wide AS
SELECT resolution, h3, count(*) AS n_variables,
       jsonb_object_agg(variable_id, mean_slope_per_decade ORDER BY variable_id) AS slopes,
       jsonb_object_agg(variable_id, significant_fdr_area_fraction ORDER BY variable_id)
           AS significant_fdr_area_fractions
FROM geo.h3_trends
GROUP BY resolution, h3;

-- 某個座標所在的 H3 格與它周圍 p_ring 圈鄰格的各變數趨勢（ring_distance 0 是所在格）
CREATE OR REPLACE FUNCTION geo.h3_trends_at(
    p_lon double precision, p_lat double precision,
    p_ring integer DEFAULT 1, p_resolution integer DEFAULT 3)
RETURNS TABLE (h3 h3index, ring_distance bigint, variable_id text, n_cells bigint,
               mean_slope_per_decade double precision,
               significant_fdr_area_fraction double precision)
LANGUAGE sql STABLE AS $$
    WITH origin AS (
        SELECT h3_latlng_to_cell(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326), p_resolution)
            AS cell
    )
    SELECT d.cell, h3_grid_distance(o.cell, d.cell), t.variable_id, t.n_cells,
           t.mean_slope_per_decade, t.significant_fdr_area_fraction
    FROM origin o
    CROSS JOIN LATERAL h3_grid_disk(o.cell, p_ring) AS d (cell)
    JOIN geo.h3_trends t ON t.h3 = d.cell AND t.resolution = p_resolution
    ORDER BY 2, 1, 3;
$$;

-- 同上，起點是 geo.locations 的一個點位
CREATE OR REPLACE FUNCTION geo.h3_neighbourhood_trends(
    p_location text, p_ring integer DEFAULT 1, p_resolution integer DEFAULT 3)
RETURNS TABLE (h3 h3index, ring_distance bigint, variable_id text, n_cells bigint,
               mean_slope_per_decade double precision,
               significant_fdr_area_fraction double precision)
LANGUAGE sql STABLE AS $$
    SELECT t.*
    FROM geo.locations l
    CROSS JOIN LATERAL geo.h3_trends_at(ST_X(l.geom), ST_Y(l.geom), p_ring, p_resolution) t
    WHERE l.location_id = p_location;
$$;
