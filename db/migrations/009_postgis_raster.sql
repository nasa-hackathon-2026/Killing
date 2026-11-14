-- postgis_raster（#91）：7 個核心變數的趨勢地圖與逐年平均存成 raster，用多邊形做區域統計。
-- 來源是 data/grid/<id>/ 的衍生檔（降解析度後的網格），由 `pg load` 載入。
CREATE EXTENSION IF NOT EXISTS postgis_raster;

-- 一個變數一張兩個 band 的 raster：band 1 斜率（每十年，32BF，nodata -9999）、
-- band 2 顯著性類別（8BUI，nodata 0；1 不顯著、2 只在校正前顯著、3 FDR 校正後顯著）。
-- 地理參考：左上角是網格的西緣與北緣，像元寬 lon_step、高 -lat_step（第一列是最北邊），EPSG:4326。
CREATE TABLE IF NOT EXISTS geo.trend_rasters (
    variable_id text PRIMARY KEY REFERENCES geo.grid_layers (variable_id),
    rast raster NOT NULL
);
CREATE INDEX IF NOT EXISTS trend_rasters_hull_gist ON geo.trend_rasters
    USING gist (ST_ConvexHull(rast));

-- 逐年平均：一個變數 × 一年一張單 band raster（32BF，nodata -9999），單位是產品原本的單位
CREATE TABLE IF NOT EXISTS geo.annual_mean_rasters (
    variable_id text NOT NULL REFERENCES geo.grid_layers (variable_id),
    year integer NOT NULL,
    unit text,
    rast raster NOT NULL,
    PRIMARY KEY (variable_id, year)
);
CREATE INDEX IF NOT EXISTS annual_mean_rasters_hull_gist ON geo.annual_mean_rasters
    USING gist (ST_ConvexHull(rast));

-- 由一個二維陣列（第一列是最北邊，NULL 是缺值）建單 band raster
CREATE OR REPLACE FUNCTION geo.make_raster(
    p_west double precision, p_north double precision,
    p_lon_step double precision, p_lat_step double precision,
    p_values double precision[], p_pixel_type text, p_nodata double precision)
RETURNS raster
LANGUAGE sql IMMUTABLE AS $$
    SELECT ST_SetValues(
        ST_AddBand(
            ST_MakeEmptyRaster(array_length(p_values, 2), array_length(p_values, 1),
                               p_west, p_north, p_lon_step, -p_lat_step, 0, 0, 4326),
            p_pixel_type, p_nodata, p_nodata),
        1, 1, 1, p_values);
$$;

-- 任意多邊形內的趨勢統計。ST_Clip 留下「像元中心落在多邊形內」的像元；ST_SummaryStats 的平均
-- 是每個像元等權，不是面積加權（高緯度的像元面積小），所以另外用 cos(像元中心緯度) 當權重再算
-- 一次：等經緯網格上像元面積正比於 cos(中心緯度)，與 geo.grid_cells.area_km2 的比例相同。
CREATE OR REPLACE FUNCTION geo.raster_zonal_trend(p_variable text, p_geom geometry)
RETURNS TABLE (n_pixels bigint,
               pixel_mean_slope_per_decade double precision,
               lat_weighted_mean_slope_per_decade double precision,
               significant_fdr_pixel_fraction double precision,
               significant_fdr_area_fraction double precision)
LANGUAGE sql STABLE AS $$
    WITH clipped AS (
        SELECT ST_Clip(t.rast, p_geom) AS rast
        FROM geo.trend_rasters t
        WHERE t.variable_id = p_variable AND ST_Intersects(t.rast, p_geom)
    ), stats AS (
        SELECT (ST_SummaryStats(rast, 1)).* FROM clipped
    ), slope AS (
        SELECT (ST_PixelAsCentroids(rast, 1)).* FROM clipped
    ), significance AS (
        SELECT (ST_PixelAsCentroids(rast, 2)).* FROM clipped
    ), pixels AS (
        SELECT s.val AS slope, g.val AS significance, cos(radians(ST_Y(s.geom))) AS weight
        FROM slope s JOIN significance g USING (x, y)
    )
    SELECT (SELECT count FROM stats),
           (SELECT mean FROM stats),
           sum(slope * weight) / sum(weight),
           (count(*) FILTER (WHERE significance = 3))::double precision / count(*),
           coalesce(sum(weight) FILTER (WHERE significance = 3), 0) / sum(weight)
    FROM pixels
    HAVING count(*) > 0;
$$;

CREATE OR REPLACE FUNCTION geo.region_raster_trend(p_variable text, p_region text)
RETURNS TABLE (variable_id text, region_id text, n_pixels bigint,
               pixel_mean_slope_per_decade double precision,
               lat_weighted_mean_slope_per_decade double precision,
               significant_fdr_pixel_fraction double precision,
               significant_fdr_area_fraction double precision)
LANGUAGE sql STABLE AS $$
    SELECT p_variable, r.location_id, z.*
    FROM geo.regions r, LATERAL geo.raster_zonal_trend(p_variable, r.geom) z
    WHERE r.location_id = p_region;
$$;

-- raster 的區域統計與既有的 geo.region_grid_trends（PostGIS 點、面積加權）並排
CREATE OR REPLACE VIEW geo.region_raster_vs_grid AS
SELECT g.variable_id, g.region_id, g.n_cells, z.n_pixels,
       g.mean_slope_per_decade AS grid_area_weighted_mean,
       z.lat_weighted_mean_slope_per_decade AS raster_lat_weighted_mean,
       z.pixel_mean_slope_per_decade AS raster_pixel_mean,
       g.significant_fdr_area_fraction AS grid_significant_area_fraction,
       z.significant_fdr_area_fraction AS raster_significant_area_fraction
FROM geo.region_grid_trends g
JOIN geo.regions r ON r.location_id = g.region_id
CROSS JOIN LATERAL geo.raster_zonal_trend(g.variable_id, r.geom) z;

-- 區域內逐年平均（像元等權與緯度加權）。只對有值的像元平均，沒有陸地遮罩。
CREATE OR REPLACE FUNCTION geo.region_raster_annual_mean(p_variable text, p_region text)
RETURNS TABLE (year integer, unit text, n_pixels bigint,
               pixel_mean double precision, lat_weighted_mean double precision)
LANGUAGE sql STABLE AS $$
    SELECT a.year, a.unit, count(*),
           avg(p.val), sum(p.val * cos(radians(ST_Y(p.geom)))) / sum(cos(radians(ST_Y(p.geom))))
    FROM geo.annual_mean_rasters a
    JOIN geo.regions r ON r.location_id = p_region
    CROSS JOIN LATERAL ST_PixelAsCentroids(ST_Clip(a.rast, r.geom), 1) p
    WHERE a.variable_id = p_variable
    GROUP BY a.year, a.unit
    ORDER BY a.year;
$$;

-- 月資料：一個變數 × 一個月一張單 band raster（32BF，nodata -9999），和上面同一個降解析度後的網格。
-- 不在 `pg load` 裡載：來源是原始立方體（data/raw/grid/，不進 git），用
-- `uv run python -m trend_detective.pg rasters-monthly` 另外載入；`load` 之後要重跑。
CREATE TABLE IF NOT EXISTS geo.monthly_rasters (
    variable_id text NOT NULL REFERENCES geo.grid_layers (variable_id),
    month date NOT NULL,
    unit text,
    rast raster NOT NULL,
    PRIMARY KEY (variable_id, month)
);

-- 區域內逐月平均（像元等權與緯度加權），可和格點區域平均的序列（area_mean_grid）對照
CREATE OR REPLACE FUNCTION geo.region_raster_monthly_mean(p_variable text, p_region text)
RETURNS TABLE (month date, unit text, n_pixels bigint,
               pixel_mean double precision, lat_weighted_mean double precision)
LANGUAGE sql STABLE AS $$
    SELECT a.month, a.unit, count(*),
           avg(p.val), sum(p.val * cos(radians(ST_Y(p.geom)))) / sum(cos(radians(ST_Y(p.geom))))
    FROM geo.monthly_rasters a
    JOIN geo.regions r ON r.location_id = p_region
    CROSS JOIN LATERAL ST_PixelAsCentroids(ST_Clip(a.rast, r.geom), 1) p
    WHERE a.variable_id = p_variable
    GROUP BY a.month, a.unit
    ORDER BY a.month;
$$;
