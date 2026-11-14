-- PostGIS：點位、區域多邊形與 7 個核心變數的趨勢格點（EPSG:4326）。
CREATE TABLE IF NOT EXISTS geo.locations (
    location_id text PRIMARY KEY REFERENCES meta.locations (id),
    geom geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS locations_geom_gist ON geo.locations USING gist (geom);

-- 台灣 5 區與世界區域（全球、各洲、北極圈以北、熱帶）；都是 seed 的經緯度方框
CREATE TABLE IF NOT EXISTS geo.regions (
    location_id text PRIMARY KEY REFERENCES meta.locations (id),
    location_group text,
    geom geometry(Polygon, 4326) NOT NULL,
    area_km2 double precision NOT NULL  -- ST_Area(geom::geography)
);
CREATE INDEX IF NOT EXISTS regions_geom_gist ON geo.regions USING gist (geom);

CREATE TABLE IF NOT EXISTS geo.grid_layers (
    variable_id text PRIMARY KEY,
    name_en text,
    slope_unit text,
    first_month text,
    last_month text,
    grid jsonb NOT NULL,    -- meta.json 的 grid（列數、行數、邊緣、間距）
    trend jsonb NOT NULL    -- meta.json 的 trend（方法、參數、各類格子數、顯著比例）
);

-- 趨勢地圖有分析的格子（顯著性類別 1–3），一列一格；來源是 data/grid/<id>/ 的衍生檔
CREATE TABLE IF NOT EXISTS geo.grid_cells (
    variable_id text NOT NULL REFERENCES geo.grid_layers (variable_id),
    lat double precision NOT NULL,   -- 格子中心
    lon double precision NOT NULL,
    centre geometry(Point, 4326) NOT NULL,
    lat_step double precision NOT NULL,
    lon_step double precision NOT NULL,
    area_km2 double precision NOT NULL,  -- 球面上經緯方格的面積（R = 6371.0088 km）
    slope_per_decade double precision NOT NULL,
    significance smallint NOT NULL,  -- 1 不顯著、2 只在校正前顯著、3 FDR 校正後顯著
    PRIMARY KEY (variable_id, lat, lon)
);
CREATE INDEX IF NOT EXISTS grid_cells_centre_gist ON geo.grid_cells USING gist (centre);

-- 空間查詢一：區域內格點趨勢的面積加權平均（格子中心落在區域內，含邊界）
CREATE OR REPLACE VIEW geo.region_grid_trends AS
SELECT c.variable_id,
       r.location_id AS region_id,
       count(*) AS n_cells,
       count(*) FILTER (WHERE c.significance = 3) AS n_cells_significant_fdr,
       sum(c.area_km2) AS analysed_area_km2,
       sum(c.slope_per_decade * c.area_km2) / sum(c.area_km2) AS mean_slope_per_decade,
       sum(c.area_km2) FILTER (WHERE c.significance = 3) / sum(c.area_km2)
           AS significant_fdr_area_fraction
FROM geo.regions r
JOIN geo.grid_cells c ON ST_Covers(r.geom, c.centre)
GROUP BY c.variable_id, r.location_id;

CREATE OR REPLACE FUNCTION geo.region_grid_trend(p_variable text, p_region text)
RETURNS SETOF geo.region_grid_trends
LANGUAGE sql STABLE AS $$
    SELECT * FROM geo.region_grid_trends
    WHERE variable_id = p_variable AND region_id = p_region;
$$;

-- 空間查詢二：離某點最近的 N 個點位／測站與它們的序列（KNN，用 GiST 索引）
CREATE OR REPLACE FUNCTION geo.nearest_series(
    p_lon double precision, p_lat double precision, p_n integer DEFAULT 5)
RETURNS TABLE (location_id text, name_en text, distance_km double precision,
               series_id integer, variable_id text, aggregation text, tier text)
LANGUAGE sql STABLE AS $$
    WITH nearest AS (
        SELECT g.location_id, g.geom
        FROM geo.locations g
        ORDER BY g.geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
        LIMIT p_n
    )
    SELECT n.location_id, l.name_en,
           ST_Distance(n.geom::geography,
                       ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) / 1000,
           s.series_id, s.variable_id, s.aggregation, s.tier
    FROM nearest n
    JOIN meta.locations l ON l.id = n.location_id
    JOIN meta.series s ON s.location_id = n.location_id
    ORDER BY 3, s.variable_id, s.aggregation;
$$;

-- 離某點最近的 N 個趨勢格子
CREATE OR REPLACE FUNCTION geo.nearest_cells(
    p_variable text, p_lon double precision, p_lat double precision, p_n integer DEFAULT 4)
RETURNS TABLE (lat double precision, lon double precision, distance_km double precision,
               slope_per_decade double precision, significance smallint)
LANGUAGE sql STABLE AS $$
    SELECT c.lat, c.lon,
           ST_Distance(c.centre::geography,
                       ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) / 1000,
           c.slope_per_decade, c.significance
    FROM geo.grid_cells c
    WHERE c.variable_id = p_variable
    ORDER BY c.centre <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
    LIMIT p_n;
$$;
