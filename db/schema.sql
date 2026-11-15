--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (Ubuntu 17.11-1.pgdg22.04+2)
-- Dumped by pg_dump version 17.11 (Ubuntu 17.11-1.pgdg22.04+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: analysis; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA analysis;


--
-- Name: clean; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA clean;


--
-- Name: geo; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA geo;


--
-- Name: meta; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA meta;


--
-- Name: obs; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA obs;


--
-- Name: raw; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA raw;


--
-- Name: build_mining_wide(text, text[]); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.build_mining_wide(p_kind text, p_exclude_locations text[] DEFAULT ARRAY['taiwan'::text]) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: correlation_components(text); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.correlation_components(p_table_kind text) RETURNS TABLE(node_id integer, variable_id text, component integer, degree integer)
    LANGUAGE sql STABLE
    AS $$
    SELECT n.node_id, n.variable_id,
           coalesce(c.component, n.node_id)::integer,
           (SELECT count(DISTINCT CASE WHEN e.source = n.node_id THEN e.target ELSE e.source END)
            FROM analysis.correlation_edges e
            WHERE e.table_kind = p_table_kind AND e.significant
              AND n.node_id IN (e.source, e.target))::integer
    FROM analysis.correlation_nodes n
    LEFT JOIN pgr_connectedComponents(format(
        'SELECT edge_id AS id, source, target, 1 AS cost FROM analysis.correlation_edges'
        ' WHERE significant AND table_kind = %L', p_table_kind)) c ON c.node = n.node_id
    WHERE n.table_kind = p_table_kind;
$$;


--
-- Name: mann_kendall(integer); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.mann_kendall(p_series_id integer, OUT n integer, OUT s double precision, OUT var_s double precision, OUT z double precision, OUT p double precision, OUT tau double precision, OUT sen_slope_per_decade double precision) RETURNS record
    LANGUAGE sql STABLE
    AS $$
    SELECT (analysis.mann_kendall_values(
        array_agg((extract(year FROM month) * 12 + extract(month FROM month))::double precision / 12
                  ORDER BY month),
        array_agg(anomaly ORDER BY month))).*
    FROM clean.observations
    WHERE series_id = p_series_id AND anomaly IS NOT NULL;
$$;


--
-- Name: mann_kendall_values(double precision[], double precision[]); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.mann_kendall_values(p_years double precision[], p_values double precision[], OUT n integer, OUT s double precision, OUT var_s double precision, OUT z double precision, OUT p double precision, OUT tau double precision, OUT sen_slope_per_decade double precision) RETURNS record
    LANGUAGE plpython3u IMMUTABLE STRICT
    AS $$
import math
from collections import Counter

values = p_values
years = p_years
count = len(values)
if count != len(years):
    plpy.error("p_years and p_values must have the same length")
if count < 3 or any(v is None for v in values) or any(t is None for t in years):
    return (count, None, None, None, None, None, None)
score = 0
slopes = []
for i in range(count - 1):
    vi, ti = values[i], years[i]
    for j in range(i + 1, count):
        difference = values[j] - vi
        if difference > 0:
            score += 1
        elif difference < 0:
            score -= 1
        if years[j] != ti:
            slopes.append(difference / (years[j] - ti))
ties = sum(t * (t - 1) * (2 * t + 5) for t in Counter(values).values() if t > 1)
variance = (count * (count - 1) * (2 * count + 5) - ties) / 18.0
if variance <= 0:
    z_score = 0.0
elif score > 0:
    z_score = (score - 1) / math.sqrt(variance)
elif score < 0:
    z_score = (score + 1) / math.sqrt(variance)
else:
    z_score = 0.0
p_value = math.erfc(abs(z_score) / math.sqrt(2))
slopes.sort()
half = len(slopes) // 2
if not slopes:
    slope = None
elif len(slopes) % 2:
    slope = slopes[half]
else:
    slope = (slopes[half - 1] + slopes[half]) / 2
return (
    count,
    float(score),
    variance,
    z_score,
    p_value,
    score / (0.5 * count * (count - 1)),
    None if slope is None else 10 * slope,
)
$$;


--
-- Name: refresh_series_embeddings(); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.refresh_series_embeddings() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    n integer;
BEGIN
    TRUNCATE analysis.series_embeddings;
    INSERT INTO analysis.series_embeddings
    SELECT w.series_id, min(w.month), max(w.month),
           count(w.fill_method)::integer, min(w.sd),
           array_agg((w.anomaly_filled - w.mean) / w.sd ORDER BY w.month)::vector(248)
    FROM (
        SELECT o.series_id, o.month, o.anomaly_filled, o.fill_method,
               avg(o.anomaly_filled) OVER series AS mean,
               stddev_pop(o.anomaly_filled) OVER series AS sd,
               count(o.anomaly_filled) OVER series AS n
        FROM clean.observations o
        JOIN clean.series_summary q USING (series_id)
        WHERE q.mining_eligible
          AND o.month BETWEEN DATE '2005-01-01' AND DATE '2025-08-01'
        WINDOW series AS (PARTITION BY o.series_id)
    ) w
    WHERE w.n = 248 AND w.sd > 0
    GROUP BY w.series_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    ANALYZE analysis.series_embeddings;
    RETURN n;
END $$;


--
-- Name: refresh_variable_graph(); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.refresh_variable_graph() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    n integer;
BEGIN
    TRUNCATE analysis.variable_graph, analysis.variable_graph_nodes;
    -- 節點：規則裡出現過的全部變數（含只出現在持續性規則裡的）
    INSERT INTO analysis.variable_graph_nodes
    SELECT (row_number() OVER (ORDER BY i.variable_id))::integer,
           i.variable_id,
           (row_number() OVER (ORDER BY i.variable_id))::integer,
           0,
           coalesce(v.is_auxiliary, false),
           (SELECT min(g.group_id) FROM analysis.same_quantity_groups g
            WHERE g.variable_id = i.variable_id),
           coalesce((SELECT array_agg(k.id ORDER BY k.id) FROM meta.known_issues k
                     WHERE k.kind <> 'auxiliary'
                       AND ((k.variable_id IS NOT NULL AND k.variable_id = i.variable_id)
                         OR (k.variable_id IS NULL AND i.variable_id ~ k.variable_pattern))),
                    '{}')
    FROM (
        SELECT DISTINCT regexp_replace(split_part(item, '=', 1), '^prev:', '') AS variable_id
        FROM analysis.mining_rules r, unnest(r.antecedents || r.consequent) AS item
    ) i
    LEFT JOIN meta.variables v ON v.id = i.variable_id;

    INSERT INTO analysis.variable_graph
    SELECT (row_number() OVER (ORDER BY p.a, p.b))::integer, na.node_id, nb.node_id, p.a, p.b,
           p.n_rules, p.table_kinds, p.timings, p.max_lift, p.min_q, 1 / p.max_lift,
           coalesce(na.same_quantity_group = nb.same_quantity_group, false)
    FROM (
        SELECT least(x.va, x.vc) AS a, greatest(x.va, x.vc) AS b,
               count(DISTINCT (x.run_id, x.table_kind, x.timing, x.rank))::integer AS n_rules,
               array_agg(DISTINCT x.table_kind ORDER BY x.table_kind) AS table_kinds,
               array_agg(DISTINCT x.timing ORDER BY x.timing) AS timings,
               max(x.lift) AS max_lift, min(x.q) AS min_q
        FROM (
            SELECT r.run_id, r.table_kind, r.timing, r.rank, r.lift, r.q,
                   regexp_replace(split_part(item, '=', 1), '^prev:', '') AS va, split_part(r.consequent, '=', 1) AS vc
            FROM analysis.mining_rules r, unnest(r.antecedents) AS item
            WHERE r.rule_set = 'rules'
        ) x
        WHERE x.va <> x.vc AND x.lift > 0
        GROUP BY 1, 2
    ) p
    JOIN analysis.variable_graph_nodes na ON na.variable_id = p.a
    JOIN analysis.variable_graph_nodes nb ON nb.variable_id = p.b;
    GET DIAGNOSTICS n = ROW_COUNT;

    IF n > 0 THEN
        UPDATE analysis.variable_graph_nodes g
        SET component = c.component
        FROM pgr_connectedComponents(
            'SELECT edge_id AS id, source, target, cost FROM analysis.variable_graph') c
        WHERE c.node = g.node_id;
        UPDATE analysis.variable_graph_nodes g
        SET n_edges = (SELECT count(*) FROM analysis.variable_graph e
                       WHERE g.node_id IN (e.source, e.target));
    END IF;
    RETURN n;
END $$;


--
-- Name: similar_series(integer, integer, jsonb); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.similar_series(p_series_id integer, p_k integer DEFAULT 10, p_filters jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(series_id integer, variable_id text, location_id text, aggregation text, tier text, cosine_similarity double precision, n_filled integer)
    LANGUAGE sql STABLE
    SET "hnsw.iterative_scan" TO 'strict_order'
    AS $$
    WITH target AS MATERIALIZED (
        SELECT s.variable_id, s.location_id, v.category_path
        FROM meta.series s JOIN meta.variables v ON v.id = s.variable_id
        WHERE s.series_id = p_series_id
    )
    SELECT e.series_id, s.variable_id, s.location_id, s.aggregation, s.tier,
           1 - (e.embedding <=> (SELECT q.embedding FROM analysis.series_embeddings q
                                 WHERE q.series_id = p_series_id)),
           e.n_filled
    FROM analysis.series_embeddings e
    JOIN meta.series s USING (series_id)
    JOIN meta.variables v ON v.id = s.variable_id
    WHERE e.series_id <> p_series_id
      AND (NOT coalesce((p_filters ->> 'different_variable')::boolean, false)
           OR s.variable_id <> (SELECT t.variable_id FROM target t))
      AND (NOT coalesce((p_filters ->> 'different_location')::boolean, false)
           OR s.location_id <> (SELECT t.location_id FROM target t))
      AND (NOT coalesce((p_filters ->> 'exclude_same_quantity')::boolean, false)
           OR NOT EXISTS (
               SELECT 1 FROM analysis.same_quantity_groups a
               JOIN analysis.same_quantity_groups b USING (group_id)
               WHERE a.variable_id = (SELECT t.variable_id FROM target t)
                 AND b.variable_id = s.variable_id))
      AND (NOT coalesce((p_filters ->> 'exclude_same_category')::boolean, false)
           OR v.category_path IS DISTINCT FROM (SELECT t.category_path FROM target t))
      AND (NOT coalesce((p_filters ->> 'exclude_auxiliary')::boolean, false)
           OR NOT v.is_auxiliary)
      AND (p_filters ->> 'tier' IS NULL OR s.tier = p_filters ->> 'tier')
      AND (p_filters ->> 'aggregation' IS NULL OR s.aggregation = p_filters ->> 'aggregation')
      AND (p_filters ->> 'category' IS NULL
           OR v.category_path <@ (p_filters ->> 'category')::ltree)
    ORDER BY e.embedding <=> (SELECT q.embedding FROM analysis.series_embeddings q
                              WHERE q.series_id = p_series_id)
    LIMIT p_k;
$$;


--
-- Name: variable_path(text, text); Type: FUNCTION; Schema: analysis; Owner: -
--

CREATE FUNCTION analysis.variable_path(p_from text, p_to text) RETURNS TABLE(seq integer, variable_id text, edge_max_lift double precision, edge_cost double precision, total_cost double precision, edge_same_quantity boolean, known_issues text[])
    LANGUAGE sql STABLE
    AS $$
    SELECT d.path_seq, n.variable_id, e.max_lift, d.cost, d.agg_cost, e.same_quantity,
           n.known_issues
    FROM pgr_dijkstra(
        'SELECT edge_id AS id, source, target, cost FROM analysis.variable_graph',
        (SELECT node_id FROM analysis.variable_graph_nodes WHERE variable_id = p_from),
        (SELECT node_id FROM analysis.variable_graph_nodes WHERE variable_id = p_to),
        directed := false) d
    JOIN analysis.variable_graph_nodes n ON n.node_id = d.node
    LEFT JOIN analysis.variable_graph e ON e.edge_id = d.edge
    ORDER BY d.path_seq;
$$;


--
-- Name: refresh_derived(); Type: FUNCTION; Schema: clean; Owner: -
--

CREATE FUNCTION clean.refresh_derived() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW clean.monthly_climatology;
    REFRESH MATERIALIZED VIEW geo.h3_trends;
END $$;


--
-- Name: sql_filled_anomalies(integer, boolean); Type: FUNCTION; Schema: clean; Owner: -
--

CREATE FUNCTION clean.sql_filled_anomalies(p_max_linear_gap integer DEFAULT NULL::integer, p_calendar_time boolean DEFAULT false) RETURNS TABLE(series_id integer, month date, anomaly_filled double precision, fill_method text)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    lo integer;
    hi integer;
    max_gap integer;
BEGIN
    SELECT min(extract(year FROM o.month)::integer * 12 + extract(month FROM o.month)::integer - 1),
           max(extract(year FROM o.month)::integer * 12 + extract(month FROM o.month)::integer - 1) + 1
    INTO lo, hi
    FROM clean.observations o;
    IF lo IS NULL THEN
        RETURN;
    END IF;
    max_gap := coalesce(
        p_max_linear_gap,
        (SELECT r.value::integer FROM meta.cleaning_rules r WHERE r.name = 'max_linear_gap_months'),
        2);
    IF p_calendar_time THEN
        RETURN QUERY
        WITH filled AS (
            SELECT o.series_id AS sid,
                   time_bucket_gapfill(INTERVAL '1 month', o.month,
                                       make_date(lo / 12, lo % 12 + 1, 1),
                                       make_date(hi / 12, hi % 12 + 1, 1)) AS bucket,
                   avg(o.anomaly) AS a,
                   interpolate(avg(o.anomaly)) AS line
            FROM clean.observations o
            WHERE o.month >= make_date(lo / 12, lo % 12 + 1, 1)
              AND o.month < make_date(hi / 12, hi % 12 + 1, 1)
              AND o.anomaly IS NOT NULL
            GROUP BY 1, 2
        ), runs AS (
            SELECT f.*, count(f.a) OVER (PARTITION BY f.sid ORDER BY f.bucket) AS run
            FROM filled f
        ), sized AS (
            SELECT r.*, count(*) FILTER (WHERE r.a IS NULL) OVER (PARTITION BY r.sid, r.run) AS gap
            FROM runs r
        )
        SELECT z.sid, z.bucket::date,
               CASE WHEN z.a IS NOT NULL THEN z.a WHEN z.gap <= max_gap THEN z.line ELSE 0 END,
               CASE WHEN z.a IS NOT NULL THEN NULL WHEN z.gap <= max_gap THEN 'linear'
                    ELSE 'climatology' END
        FROM sized z
        WHERE z.line IS NOT NULL;
        RETURN;
    END IF;
    RETURN QUERY
    WITH filled AS (
        SELECT o.series_id AS sid,
               time_bucket_gapfill(
                   1,
                   extract(year FROM o.month)::integer * 12 + extract(month FROM o.month)::integer - 1,
                   lo, hi) AS bucket,
               avg(o.anomaly) AS a,
               interpolate(avg(o.anomaly)) AS line
        FROM clean.observations o
        WHERE o.anomaly IS NOT NULL  -- 沒有距平的月份當成缺的 bucket，讓 gapfill 補出來
        GROUP BY 1, 2
    ), runs AS (
        -- 每個可用月份開一段；它後面連續的缺月和它同一段
        SELECT f.*, count(f.a) OVER (PARTITION BY f.sid ORDER BY f.bucket) AS run
        FROM filled f
    ), sized AS (
        SELECT r.*, count(*) FILTER (WHERE r.a IS NULL) OVER (PARTITION BY r.sid, r.run) AS gap
        FROM runs r
    )
    -- line 是 NULL：第一個可用月份之前或最後一個之後（不外推），不回傳
    SELECT z.sid, make_date(z.bucket / 12, z.bucket % 12 + 1, 1),
           CASE WHEN z.a IS NOT NULL THEN z.a WHEN z.gap <= max_gap THEN z.line ELSE 0 END,
           CASE WHEN z.a IS NOT NULL THEN NULL WHEN z.gap <= max_gap THEN 'linear'
                ELSE 'climatology' END
    FROM sized z
    WHERE z.line IS NOT NULL;
END $$;


--
-- Name: h3_neighbourhood_trends(text, integer, integer); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.h3_neighbourhood_trends(p_location text, p_ring integer DEFAULT 1, p_resolution integer DEFAULT 3) RETURNS TABLE(h3 public.h3index, ring_distance bigint, variable_id text, n_cells bigint, mean_slope_per_decade double precision, significant_fdr_area_fraction double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT t.*
    FROM geo.locations l
    CROSS JOIN LATERAL geo.h3_trends_at(ST_X(l.geom), ST_Y(l.geom), p_ring, p_resolution) t
    WHERE l.location_id = p_location;
$$;


--
-- Name: h3_trends_at(double precision, double precision, integer, integer); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.h3_trends_at(p_lon double precision, p_lat double precision, p_ring integer DEFAULT 1, p_resolution integer DEFAULT 3) RETURNS TABLE(h3 public.h3index, ring_distance bigint, variable_id text, n_cells bigint, mean_slope_per_decade double precision, significant_fdr_area_fraction double precision)
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: make_raster(double precision, double precision, double precision, double precision, double precision[], text, double precision); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.make_raster(p_west double precision, p_north double precision, p_lon_step double precision, p_lat_step double precision, p_values double precision[], p_pixel_type text, p_nodata double precision) RETURNS public.raster
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT ST_SetValues(
        ST_AddBand(
            ST_MakeEmptyRaster(array_length(p_values, 2), array_length(p_values, 1),
                               p_west, p_north, p_lon_step, -p_lat_step, 0, 0, 4326),
            p_pixel_type, p_nodata, p_nodata),
        1, 1, 1, p_values);
$$;


--
-- Name: nearest_cells(text, double precision, double precision, integer); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.nearest_cells(p_variable text, p_lon double precision, p_lat double precision, p_n integer DEFAULT 4) RETURNS TABLE(lat double precision, lon double precision, distance_km double precision, slope_per_decade double precision, significance smallint)
    LANGUAGE sql STABLE
    AS $$
    SELECT c.lat, c.lon,
           ST_Distance(c.centre::geography,
                       ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography) / 1000,
           c.slope_per_decade, c.significance
    FROM geo.grid_cells c
    WHERE c.variable_id = p_variable
    ORDER BY c.centre <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
    LIMIT p_n;
$$;


--
-- Name: nearest_series(double precision, double precision, integer); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.nearest_series(p_lon double precision, p_lat double precision, p_n integer DEFAULT 5) RETURNS TABLE(location_id text, name_en text, distance_km double precision, series_id integer, variable_id text, aggregation text, tier text)
    LANGUAGE sql STABLE
    AS $$
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


--
-- Name: raster_zonal_trend(text, public.geometry); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.raster_zonal_trend(p_variable text, p_geom public.geometry) RETURNS TABLE(n_pixels bigint, pixel_mean_slope_per_decade double precision, lat_weighted_mean_slope_per_decade double precision, significant_fdr_pixel_fraction double precision, significant_fdr_area_fraction double precision)
    LANGUAGE sql STABLE
    AS $$
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: grid_cells; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.grid_cells (
    variable_id text NOT NULL,
    lat double precision NOT NULL,
    lon double precision NOT NULL,
    centre public.geometry(Point,4326) NOT NULL,
    lat_step double precision NOT NULL,
    lon_step double precision NOT NULL,
    area_km2 double precision NOT NULL,
    slope_per_decade double precision NOT NULL,
    significance smallint NOT NULL,
    h3_res3 public.h3index GENERATED ALWAYS AS (public.h3_latlng_to_cell(centre, 3)) STORED
);


--
-- Name: regions; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.regions (
    location_id text NOT NULL,
    location_group text,
    geom public.geometry(Polygon,4326) NOT NULL,
    area_km2 double precision NOT NULL
);


--
-- Name: region_grid_trends; Type: VIEW; Schema: geo; Owner: -
--

CREATE VIEW geo.region_grid_trends AS
 SELECT c.variable_id,
    r.location_id AS region_id,
    count(*) AS n_cells,
    count(*) FILTER (WHERE (c.significance = 3)) AS n_cells_significant_fdr,
    sum(c.area_km2) AS analysed_area_km2,
    (sum((c.slope_per_decade * c.area_km2)) / sum(c.area_km2)) AS mean_slope_per_decade,
    (sum(c.area_km2) FILTER (WHERE (c.significance = 3)) / sum(c.area_km2)) AS significant_fdr_area_fraction
   FROM (geo.regions r
     JOIN geo.grid_cells c ON (public.st_covers(r.geom, c.centre)))
  GROUP BY c.variable_id, r.location_id;


--
-- Name: region_grid_trend(text, text); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.region_grid_trend(p_variable text, p_region text) RETURNS SETOF geo.region_grid_trends
    LANGUAGE sql STABLE
    AS $$
    SELECT * FROM geo.region_grid_trends
    WHERE variable_id = p_variable AND region_id = p_region;
$$;


--
-- Name: region_raster_annual_mean(text, text); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.region_raster_annual_mean(p_variable text, p_region text) RETURNS TABLE(year integer, unit text, n_pixels bigint, pixel_mean double precision, lat_weighted_mean double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT a.year, a.unit, count(*),
           avg(p.val), sum(p.val * cos(radians(ST_Y(p.geom)))) / sum(cos(radians(ST_Y(p.geom))))
    FROM geo.annual_mean_rasters a
    JOIN geo.regions r ON r.location_id = p_region
    CROSS JOIN LATERAL ST_PixelAsCentroids(ST_Clip(a.rast, r.geom), 1) p
    WHERE a.variable_id = p_variable
    GROUP BY a.year, a.unit
    ORDER BY a.year;
$$;


--
-- Name: region_raster_monthly_mean(text, text); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.region_raster_monthly_mean(p_variable text, p_region text) RETURNS TABLE(month date, unit text, n_pixels bigint, pixel_mean double precision, lat_weighted_mean double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT a.month, a.unit, count(*),
           avg(p.val), sum(p.val * cos(radians(ST_Y(p.geom)))) / sum(cos(radians(ST_Y(p.geom))))
    FROM geo.monthly_rasters a
    JOIN geo.regions r ON r.location_id = p_region
    CROSS JOIN LATERAL ST_PixelAsCentroids(ST_Clip(a.rast, r.geom), 1) p
    WHERE a.variable_id = p_variable
    GROUP BY a.month, a.unit
    ORDER BY a.month;
$$;


--
-- Name: region_raster_trend(text, text); Type: FUNCTION; Schema: geo; Owner: -
--

CREATE FUNCTION geo.region_raster_trend(p_variable text, p_region text) RETURNS TABLE(variable_id text, region_id text, n_pixels bigint, pixel_mean_slope_per_decade double precision, lat_weighted_mean_slope_per_decade double precision, significant_fdr_pixel_fraction double precision, significant_fdr_area_fraction double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT p_variable, r.location_id, z.*
    FROM geo.regions r, LATERAL geo.raster_zonal_trend(p_variable, r.geom) z
    WHERE r.location_id = p_region;
$$;


--
-- Name: convert_unit(double precision, text, text); Type: FUNCTION; Schema: meta; Owner: -
--

CREATE FUNCTION meta.convert_unit(p_value double precision, p_from text, p_to text) RETURNS double precision
    LANGUAGE sql IMMUTABLE
    AS $$
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


--
-- Name: refresh_search_documents(); Type: FUNCTION; Schema: meta; Owner: -
--

CREATE FUNCTION meta.refresh_search_documents() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    n integer;
BEGIN
    TRUNCATE meta.search_documents RESTART IDENTITY;
    INSERT INTO meta.search_documents (kind, ref_id, title, body)
    SELECT 'variable', v.id, coalesce(v.name_en, v.id),
           concat_ws(' ', replace(v.id, '_', ' '), v.name_en, v.unit, v.product,
                     replace(v.category_path::text, '.', ' '), v.data_kind,
                     replace(v.data_kind, '_', ' '), v.data_kind_note)
    FROM meta.variables v
    UNION ALL
    SELECT 'product', v.product, v.product,
           concat_ws(' ', v.product, max(v.citation), max(v.doi), max(v.source),
                     string_agg(v.name_en, '; ' ORDER BY v.id))
    FROM meta.variables v
    WHERE v.product IS NOT NULL
    GROUP BY v.product
    UNION ALL
    SELECT 'known_issue', k.id, k.kind || ': ' || coalesce(k.variable_id, k.variable_pattern),
           concat_ws(' ', k.summary_en, replace(k.kind, '_', ' '),
                     replace(coalesce(k.variable_id, ''), '_', ' '), k.source_doc)
    FROM meta.known_issues k;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;


--
-- Name: search_text(text, integer); Type: FUNCTION; Schema: meta; Owner: -
--

CREATE FUNCTION meta.search_text(p_query text, p_limit integer DEFAULT 10) RETURNS TABLE(kind text, ref_id text, title text, score double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT d.kind, d.ref_id, d.title,
           -(d.body <@> to_bm25query(p_query, 'meta.search_documents_bm25')) AS score
    FROM meta.search_documents d
    WHERE d.body <@> to_bm25query(p_query, 'meta.search_documents_bm25') < 0
    ORDER BY d.body <@> to_bm25query(p_query, 'meta.search_documents_bm25'), d.kind, d.ref_id
    LIMIT p_limit;
$$;


--
-- Name: search_variables(text, integer); Type: FUNCTION; Schema: meta; Owner: -
--

CREATE FUNCTION meta.search_variables(p_query text, p_limit integer DEFAULT 10) RETURNS TABLE(id text, name_en text, product text, tier text, is_auxiliary boolean, similarity real)
    LANGUAGE sql STABLE
    AS $$
    SELECT v.id, v.name_en, v.product, v.tier, v.is_auxiliary,
           word_similarity(p_query, v.id || ' ' || coalesce(v.name_en, '')) AS similarity
    FROM meta.variables v
    WHERE p_query <% (v.id || ' ' || coalesce(v.name_en, ''))
    ORDER BY similarity DESC, v.id
    LIMIT p_limit;
$$;


--
-- Name: series_in_category(text); Type: FUNCTION; Schema: meta; Owner: -
--

CREATE FUNCTION meta.series_in_category(p_path text) RETURNS TABLE(series_id integer, variable_id text, location_id text, aggregation text, tier text, category_path public.ltree)
    LANGUAGE sql STABLE
    AS $$
    SELECT s.series_id, s.variable_id, s.location_id, s.aggregation, s.tier, v.category_path
    FROM meta.variables v
    JOIN meta.series s ON s.variable_id = v.id
    WHERE v.category_path <@ p_path::ltree
    ORDER BY v.category_path, s.variable_id, s.location_id, s.aggregation;
$$;


--
-- Name: missing_months(); Type: FUNCTION; Schema: obs; Owner: -
--

CREATE FUNCTION obs.missing_months() RETURNS TABLE(series_id integer, month date, missing_kind text)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    lo date;
    hi date;
BEGIN
    SELECT min(o.month), (max(o.month) + INTERVAL '1 month')::date INTO lo, hi
    FROM obs.observations o;
    IF lo IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    WITH skeleton AS (
        SELECT o.series_id AS sid,
               time_bucket_gapfill(INTERVAL '1 month', o.month, lo, hi) AS bucket,
               count(o.value_raw) AS n_values
        FROM obs.observations o
        WHERE o.month >= lo AND o.month < hi
        GROUP BY 1, 2
    )
    SELECT k.sid, k.bucket::date,
           CASE WHEN k.n_values IS NULL THEN 'no_row' ELSE 'null_value' END
    FROM skeleton k
    JOIN meta.series s ON s.series_id = k.sid
    WHERE k.bucket >= s.first_month AND k.bucket <= s.last_month
      AND coalesce(k.n_values, 0) = 0;
END $$;


--
-- Name: check_file_planetary_computer(); Type: FUNCTION; Schema: raw; Owner: -
--

CREATE FUNCTION raw.check_file_planetary_computer() RETURNS TABLE(n_file bigint, n_loaded bigint, n_only_in_file bigint, n_only_loaded bigint, n_value_differs bigint, max_abs_difference double precision)
    LANGUAGE sql STABLE
    AS $$
    SELECT count(f.date), count(l.obs_key),
           count(*) FILTER (WHERE l.obs_key IS NULL),
           count(*) FILTER (WHERE f.date IS NULL),
           count(*) FILTER (WHERE f.date IS NOT NULL AND l.obs_key IS NOT NULL
                              AND f.mean IS DISTINCT FROM l.value),
           max(abs(f.mean - l.value))
    FROM raw.file_planetary_computer f
    FULL JOIN raw.planetary_computer l
      ON l.variable_id = f.variable_id AND l.location_id = f.location_id
     AND l.obs_key = f.date::text;
$$;


--
-- Name: observations; Type: TABLE; Schema: obs; Owner: -
--

CREATE TABLE obs.observations (
    series_id integer NOT NULL,
    month date NOT NULL,
    value_raw double precision,
    n_samples integer,
    coverage double precision,
    source_api text NOT NULL,
    tier text NOT NULL
);


--
-- Name: correlation_edges; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.correlation_edges (
    table_kind text NOT NULL,
    edge_id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    source_variable text NOT NULL,
    target_variable text NOT NULL,
    lag integer NOT NULL,
    r double precision NOT NULL,
    p double precision NOT NULL,
    q double precision NOT NULL,
    n_eff double precision NOT NULL,
    significant boolean NOT NULL
);


--
-- Name: correlation_nodes; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.correlation_nodes (
    table_kind text NOT NULL,
    node_id integer NOT NULL,
    variable_id text NOT NULL,
    component integer NOT NULL,
    degree integer NOT NULL
);


--
-- Name: gap_stats; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.gap_stats (
    run_id bigint NOT NULL,
    "grouping" text NOT NULL,
    model_variable text NOT NULL,
    group_value text NOT NULL,
    n_months integer NOT NULL,
    mean_abs_difference double precision NOT NULL,
    median_abs_difference double precision NOT NULL,
    ci_low double precision,
    ci_high double precision
);


--
-- Name: gap_tree_folds; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.gap_tree_folds (
    run_id bigint NOT NULL,
    variant text NOT NULL,
    validation text NOT NULL,
    fold integer NOT NULL,
    held_out_station text,
    test_first_month date,
    test_last_month date,
    n_train integer NOT NULL,
    n_test integer NOT NULL,
    test_accuracy double precision NOT NULL,
    macro_f1 double precision NOT NULL,
    train_majority_accuracy double precision NOT NULL,
    persistence_accuracy double precision NOT NULL,
    calendar_month_accuracy double precision NOT NULL,
    above_all_baselines boolean NOT NULL,
    tree jsonb NOT NULL
);


--
-- Name: mining_rules; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.mining_rules (
    run_id bigint NOT NULL,
    table_kind text NOT NULL,
    timing text NOT NULL,
    rule_set text NOT NULL,
    rank integer NOT NULL,
    antecedents text[] NOT NULL,
    consequent text NOT NULL,
    support double precision,
    confidence double precision,
    lift double precision,
    p double precision,
    q double precision
);


--
-- Name: mining_runs; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.mining_runs (
    run_id bigint NOT NULL,
    kind text NOT NULL,
    primary_variant text NOT NULL,
    parameters jsonb NOT NULL,
    summary jsonb NOT NULL,
    gap_filling_sensitivity jsonb NOT NULL,
    CONSTRAINT mining_runs_kind_check CHECK ((kind = ANY (ARRAY['fpgrowth'::text, 'decision_tree'::text])))
);


--
-- Name: mining_wide_point; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.mining_wide_point (
    location_id text NOT NULL,
    month date NOT NULL,
    airs_h2ovap double precision,
    airs_tsurf double precision,
    gldas_evap double precision,
    gldas_soilmoist double precision,
    gldas_tair double precision,
    imerg_precip double precision,
    merra2_t2m double precision,
    modis_lst double precision,
    modis_ndvi double precision,
    omi_aerosol double precision,
    omi_no2 double precision,
    omi_o3 double precision,
    power_t2m double precision
);


--
-- Name: mining_wide_region; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.mining_wide_region (
    location_id text NOT NULL,
    month date NOT NULL,
    airs_h2ovap double precision,
    airs_tsurf double precision,
    gldas_evap double precision,
    gldas_soilmoist double precision,
    gldas_tair double precision,
    imerg_precip double precision,
    merra2_t2m double precision,
    modis_lst double precision,
    modis_lst_pc double precision,
    modis_ndvi double precision,
    modis_ndvi_pc double precision,
    omi_aerosol double precision,
    omi_no2 double precision,
    omi_o3 double precision
);


--
-- Name: trends; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.trends (
    series_id integer NOT NULL,
    run_id bigint NOT NULL,
    status text NOT NULL,
    reason_code text,
    first_month date,
    last_month date,
    n_valid integer,
    missing_fraction double precision,
    slope_per_decade double precision,
    ci_low_per_decade double precision,
    ci_high_per_decade double precision,
    ols_p double precision,
    ols_q double precision,
    ols_significant boolean,
    ols_significant_fdr boolean,
    lag1_autocorrelation double precision,
    n_effective double precision,
    mk_original_p double precision,
    mk_original_q double precision,
    mk_hamed_rao_p double precision,
    mk_hamed_rao_q double precision,
    mk_seasonal_p double precision,
    mk_seasonal_q double precision,
    sen_slope_per_decade double precision,
    fdr_scope text,
    auxiliary boolean DEFAULT false NOT NULL,
    known_issues text[] DEFAULT '{}'::text[] NOT NULL,
    cleaning jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb NOT NULL
);


--
-- Name: observations; Type: TABLE; Schema: clean; Owner: -
--

CREATE TABLE clean.observations (
    series_id integer NOT NULL,
    month date NOT NULL,
    in_source boolean NOT NULL,
    value_raw double precision,
    value_clean double precision,
    qc_flag text NOT NULL,
    qc_flags text[] NOT NULL,
    anomaly double precision,
    anomaly_filled double precision,
    fill_method text,
    n_samples integer,
    coverage double precision,
    CONSTRAINT observations_fill_method_check CHECK ((fill_method = ANY (ARRAY['linear'::text, 'climatology'::text]))),
    CONSTRAINT observations_qc_flag_check CHECK ((qc_flag = ANY (ARRAY['ok'::text, 'low_coverage'::text, 'missing'::text, 'partial_month'::text, 'outlier_suspect'::text, 'known_discontinuity'::text])))
);


--
-- Name: series_summary; Type: TABLE; Schema: clean; Owner: -
--

CREATE TABLE clean.series_summary (
    series_id integer NOT NULL,
    n_months integer NOT NULL,
    n_in_source integer NOT NULL,
    n_usable integer NOT NULL,
    first_usable_month date,
    last_usable_month date,
    n_ok integer NOT NULL,
    n_missing integer NOT NULL,
    n_partial_month integer NOT NULL,
    n_low_coverage integer NOT NULL,
    n_outlier_suspect integer NOT NULL,
    n_known_discontinuity integer NOT NULL,
    n_filled integer NOT NULL,
    n_filled_linear integer NOT NULL,
    n_filled_climatology integer NOT NULL,
    n_gaps integer NOT NULL,
    longest_gap_months integer NOT NULL,
    fill_fraction double precision,
    mining_eligible boolean NOT NULL,
    auxiliary boolean NOT NULL,
    known_issues text[] NOT NULL,
    detail jsonb NOT NULL
);


--
-- Name: series; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.series (
    series_id integer NOT NULL,
    variable_id text NOT NULL,
    location_id text NOT NULL,
    aggregation text NOT NULL,
    tier text NOT NULL,
    source_api text NOT NULL,
    unit text,
    product_version text,
    retrieved_at timestamp with time zone,
    grid_lat double precision,
    grid_lon double precision,
    n_points integer NOT NULL,
    first_month date,
    last_month date,
    request jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT series_tier_check CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text, 'observed'::text])))
);


--
-- Name: mining_wide_source; Type: VIEW; Schema: analysis; Owner: -
--

CREATE VIEW analysis.mining_wide_source AS
 SELECT
        CASE s.aggregation
            WHEN 'point'::text THEN 'point'::text
            ELSE 'region'::text
        END AS table_kind,
    s.series_id,
    s.location_id,
    s.variable_id,
    o.month,
    o.anomaly_filled
   FROM (((meta.series s
     JOIN clean.series_summary q USING (series_id))
     JOIN clean.observations o USING (series_id))
     LEFT JOIN analysis.trends t USING (series_id))
  WHERE ((s.tier = 'core'::text) AND (s.aggregation = ANY (ARRAY['point'::text, 'area_mean'::text])) AND q.mining_eligible AND (COALESCE(t.status, 'analyzed'::text) = 'analyzed'::text) AND ((o.month >= q.first_usable_month) AND (o.month <= q.last_usable_month)));


--
-- Name: model_obs_pairs; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.model_obs_pairs (
    pair_id text NOT NULL,
    run_id bigint NOT NULL,
    pair_group text NOT NULL,
    quantity text NOT NULL,
    location_id text NOT NULL,
    model_variable_id text NOT NULL,
    model_source text NOT NULL,
    model_series_id integer,
    model_detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    obs_variable_id text NOT NULL,
    obs_series_id integer NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    status text NOT NULL,
    n_common_months integer NOT NULL,
    first_common_month date,
    last_common_month date,
    correlation double precision,
    diff_mean double precision,
    diff_sd double precision,
    diff_rmse double precision,
    model_slope_per_decade double precision,
    model_ci_low double precision,
    model_ci_high double precision,
    obs_slope_per_decade double precision,
    obs_ci_low double precision,
    obs_ci_high double precision,
    slope_difference double precision,
    diff_slope_per_decade double precision,
    diff_ci_low double precision,
    diff_ci_high double precision,
    diff_slope_p double precision,
    diff_slope_significant boolean,
    largest_step double precision,
    largest_step_month date,
    known_issues text[] DEFAULT '{}'::text[] NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: runs; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.runs (
    run_id bigint NOT NULL,
    step text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone NOT NULL,
    git_commit text,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    rows_affected jsonb DEFAULT '{}'::jsonb NOT NULL,
    note text
);


--
-- Name: runs_run_id_seq; Type: SEQUENCE; Schema: analysis; Owner: -
--

ALTER TABLE analysis.runs ALTER COLUMN run_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME analysis.runs_run_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: same_quantity_groups; Type: VIEW; Schema: analysis; Owner: -
--

CREATE VIEW analysis.same_quantity_groups AS
 SELECT (g.group_id)::integer AS group_id,
    m.variable_id
   FROM ((( SELECT mining_runs.parameters
           FROM analysis.mining_runs
          WHERE (mining_runs.parameters ? 'same_quantity_groups'::text)
          ORDER BY mining_runs.run_id DESC
         LIMIT 1) r
     CROSS JOIN LATERAL jsonb_array_elements((r.parameters -> 'same_quantity_groups'::text)) WITH ORDINALITY g(members, group_id))
     CROSS JOIN LATERAL jsonb_array_elements_text(g.members) m(variable_id));


--
-- Name: series_embeddings; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.series_embeddings (
    series_id integer NOT NULL,
    first_month date NOT NULL,
    last_month date NOT NULL,
    n_filled integer NOT NULL,
    anomaly_sd double precision NOT NULL,
    embedding public.vector(248) NOT NULL
);


--
-- Name: significant_trends; Type: VIEW; Schema: analysis; Owner: -
--

CREATE VIEW analysis.significant_trends AS
 SELECT s.variable_id,
    s.location_id,
    s.aggregation,
    s.tier,
    t.slope_per_decade,
    t.ci_low_per_decade,
    t.ci_high_per_decade,
    t.ols_p,
    t.ols_q,
    t.known_issues,
    t.cleaning
   FROM (analysis.trends t
     JOIN meta.series s USING (series_id))
  WHERE (t.ols_significant_fdr AND (NOT t.auxiliary));


--
-- Name: tree_folds; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.tree_folds (
    run_id bigint NOT NULL,
    variant text NOT NULL,
    fold integer NOT NULL,
    test_first_month date,
    test_last_month date,
    n_train integer,
    n_test integer,
    test_accuracy double precision,
    train_majority_accuracy double precision,
    test_majority_accuracy double precision,
    persistence_accuracy double precision,
    tree jsonb
);


--
-- Name: variable_graph; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.variable_graph (
    edge_id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    source_variable text NOT NULL,
    target_variable text NOT NULL,
    n_rules integer NOT NULL,
    table_kinds text[] NOT NULL,
    timings text[] NOT NULL,
    max_lift double precision NOT NULL,
    min_q double precision NOT NULL,
    cost double precision NOT NULL,
    same_quantity boolean NOT NULL
);


--
-- Name: variable_graph_nodes; Type: TABLE; Schema: analysis; Owner: -
--

CREATE TABLE analysis.variable_graph_nodes (
    node_id integer NOT NULL,
    variable_id text NOT NULL,
    component integer NOT NULL,
    n_edges integer NOT NULL,
    is_auxiliary boolean NOT NULL,
    same_quantity_group integer,
    known_issues text[] NOT NULL
);


--
-- Name: variable_graph_components; Type: VIEW; Schema: analysis; Owner: -
--

CREATE VIEW analysis.variable_graph_components AS
 SELECT component,
    count(*) AS n_variables,
    array_agg(variable_id ORDER BY variable_id) AS variables,
    array_agg(variable_id ORDER BY variable_id) FILTER (WHERE (cardinality(known_issues) > 0)) AS variables_with_known_issues,
    array_agg(variable_id ORDER BY variable_id) FILTER (WHERE (same_quantity_group IS NOT NULL)) AS variables_in_same_quantity_groups
   FROM analysis.variable_graph_nodes
  GROUP BY component;


--
-- Name: mining_input; Type: VIEW; Schema: clean; Owner: -
--

CREATE VIEW clean.mining_input AS
 SELECT o.series_id,
    s.variable_id,
    s.location_id,
    s.aggregation,
    s.tier,
    o.month,
    o.anomaly_filled,
    o.fill_method
   FROM ((clean.observations o
     JOIN meta.series s USING (series_id))
     JOIN clean.series_summary q USING (series_id))
  WHERE ((o.anomaly_filled IS NOT NULL) AND q.mining_eligible);


--
-- Name: monthly_climatology; Type: MATERIALIZED VIEW; Schema: clean; Owner: -
--

CREATE MATERIALIZED VIEW clean.monthly_climatology AS
 SELECT series_id,
    (EXTRACT(month FROM month))::smallint AS calendar_month,
    avg(value_clean) AS mean_value,
    count(value_clean) AS n_years
   FROM clean.observations
  WHERE (value_clean IS NOT NULL)
  GROUP BY series_id, (EXTRACT(month FROM month))
  WITH NO DATA;


--
-- Name: toolkit_climatology; Type: VIEW; Schema: clean; Owner: -
--

CREATE VIEW clean.toolkit_climatology AS
 SELECT series_id,
    calendar_month,
    public.average(summary) AS mean_value,
    public.num_vals(summary) AS n_years,
    public.stddev(summary) AS sd_value
   FROM ( SELECT observations.series_id,
            (EXTRACT(month FROM observations.month))::smallint AS calendar_month,
            public.stats_agg(observations.value_clean) AS summary
           FROM clean.observations
          WHERE (observations.value_clean IS NOT NULL)
          GROUP BY observations.series_id, ((EXTRACT(month FROM observations.month))::smallint)) s;


--
-- Name: toolkit_anomalies; Type: VIEW; Schema: clean; Owner: -
--

CREATE VIEW clean.toolkit_anomalies AS
 SELECT o.series_id,
    o.month,
    (o.value_clean - c.mean_value) AS anomaly_sql,
    o.anomaly
   FROM (clean.observations o
     JOIN clean.toolkit_climatology c ON (((c.series_id = o.series_id) AND ((c.calendar_month)::numeric = EXTRACT(month FROM o.month)))))
  WHERE (o.value_clean IS NOT NULL);


--
-- Name: trend_input; Type: VIEW; Schema: clean; Owner: -
--

CREATE VIEW clean.trend_input AS
 SELECT o.series_id,
    s.variable_id,
    s.location_id,
    s.aggregation,
    s.tier,
    o.month,
    o.value_clean,
    o.anomaly,
    o.qc_flag,
    o.qc_flags
   FROM (clean.observations o
     JOIN meta.series s USING (series_id))
  WHERE (o.value_clean IS NOT NULL);


--
-- Name: annual_mean_rasters; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.annual_mean_rasters (
    variable_id text NOT NULL,
    year integer NOT NULL,
    unit text,
    rast public.raster NOT NULL
);


--
-- Name: grid_layers; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.grid_layers (
    variable_id text NOT NULL,
    name_en text,
    slope_unit text,
    first_month text,
    last_month text,
    grid jsonb NOT NULL,
    trend jsonb NOT NULL
);


--
-- Name: h3_trends; Type: MATERIALIZED VIEW; Schema: geo; Owner: -
--

CREATE MATERIALIZED VIEW geo.h3_trends AS
 SELECT r.resolution,
    public.h3_cell_to_parent(c.h3_res3, r.resolution) AS h3,
    c.variable_id,
    count(*) AS n_cells,
    sum(c.area_km2) AS analysed_area_km2,
    (sum((c.slope_per_decade * c.area_km2)) / sum(c.area_km2)) AS mean_slope_per_decade,
    (COALESCE(sum(c.area_km2) FILTER (WHERE (c.significance = 3)), (0)::double precision) / sum(c.area_km2)) AS significant_fdr_area_fraction
   FROM (geo.grid_cells c
     CROSS JOIN ( VALUES (2), (3)) r(resolution))
  GROUP BY r.resolution, (public.h3_cell_to_parent(c.h3_res3, r.resolution)), c.variable_id
  WITH NO DATA;


--
-- Name: h3_trends_wide; Type: VIEW; Schema: geo; Owner: -
--

CREATE VIEW geo.h3_trends_wide AS
 SELECT resolution,
    h3,
    count(*) AS n_variables,
    jsonb_object_agg(variable_id, mean_slope_per_decade ORDER BY variable_id) AS slopes,
    jsonb_object_agg(variable_id, significant_fdr_area_fraction ORDER BY variable_id) AS significant_fdr_area_fractions
   FROM geo.h3_trends
  GROUP BY resolution, h3;


--
-- Name: locations; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.locations (
    location_id text NOT NULL,
    geom public.geometry(Point,4326) NOT NULL,
    h3_res3 public.h3index GENERATED ALWAYS AS (public.h3_latlng_to_cell(geom, 3)) STORED
);


--
-- Name: monthly_rasters; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.monthly_rasters (
    variable_id text NOT NULL,
    month date NOT NULL,
    unit text,
    rast public.raster NOT NULL
);


--
-- Name: region_raster_vs_grid; Type: VIEW; Schema: geo; Owner: -
--

CREATE VIEW geo.region_raster_vs_grid AS
 SELECT g.variable_id,
    g.region_id,
    g.n_cells,
    z.n_pixels,
    g.mean_slope_per_decade AS grid_area_weighted_mean,
    z.lat_weighted_mean_slope_per_decade AS raster_lat_weighted_mean,
    z.pixel_mean_slope_per_decade AS raster_pixel_mean,
    g.significant_fdr_area_fraction AS grid_significant_area_fraction,
    z.significant_fdr_area_fraction AS raster_significant_area_fraction
   FROM ((geo.region_grid_trends g
     JOIN geo.regions r ON ((r.location_id = g.region_id)))
     CROSS JOIN LATERAL geo.raster_zonal_trend(g.variable_id, r.geom) z(n_pixels, pixel_mean_slope_per_decade, lat_weighted_mean_slope_per_decade, significant_fdr_pixel_fraction, significant_fdr_area_fraction));


--
-- Name: trend_rasters; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.trend_rasters (
    variable_id text NOT NULL,
    rast public.raster NOT NULL
);


--
-- Name: variables; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.variables (
    id text NOT NULL,
    name_zh text,
    name_en text,
    definition_zh text,
    category text,
    unit text,
    source text,
    source_variable_id text,
    product text,
    product_version text,
    native_temporal_res text,
    is_nasa boolean,
    doi text,
    citation text,
    note_zh text,
    tier text NOT NULL,
    needs_translation boolean DEFAULT false NOT NULL,
    is_auxiliary boolean DEFAULT false NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    data_kind text DEFAULT 'unknown'::text NOT NULL,
    data_kind_note text,
    category_path public.ltree,
    category_basis text,
    CONSTRAINT variables_data_kind_check CHECK ((data_kind = ANY (ARRAY['in_situ'::text, 'satellite_retrieval'::text, 'model'::text, 'unknown'::text]))),
    CONSTRAINT variables_tier_check CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text, 'observed'::text])))
);


--
-- Name: category_tree; Type: VIEW; Schema: meta; Owner: -
--

CREATE VIEW meta.category_tree AS
 WITH nodes AS (
         SELECT DISTINCT public.subpath(v_1.category_path, 0, level.level) AS path
           FROM meta.variables v_1,
            LATERAL generate_series(1, public.nlevel(v_1.category_path)) level(level)
          WHERE (v_1.category_path IS NOT NULL)
        )
 SELECT n.path,
    public.nlevel(n.path) AS depth,
    count(DISTINCT v.id) AS n_variables,
    count(s.series_id) AS n_series
   FROM ((nodes n
     JOIN meta.variables v ON ((v.category_path OPERATOR(public.<@) n.path)))
     LEFT JOIN meta.series s ON ((s.variable_id = v.id)))
  GROUP BY n.path;


--
-- Name: cleaning_rules; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.cleaning_rules (
    name text NOT NULL,
    value double precision NOT NULL,
    note_en text
);


--
-- Name: display_units; Type: VIEW; Schema: meta; Owner: -
--

CREATE VIEW meta.display_units AS
 SELECT id AS variable_id,
    unit,
        CASE unit
            WHEN 'K'::text THEN 'degC'::text
            WHEN 'kg m-2 s-1'::text THEN 'mm/day'::text
            WHEN 'mm/hr'::text THEN 'mm/day'::text
            WHEN 'Pa'::text THEN 'hPa'::text
            ELSE NULL::text
        END AS display_unit
   FROM meta.variables v
  WHERE (unit = ANY (ARRAY['K'::text, 'kg m-2 s-1'::text, 'mm/hr'::text, 'Pa'::text]));


--
-- Name: known_issues; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.known_issues (
    id text NOT NULL,
    kind text NOT NULL,
    variable_id text,
    variable_pattern text,
    aggregation text,
    period_start date,
    period_end date,
    flag_months boolean DEFAULT false NOT NULL,
    summary_en text NOT NULL,
    source_doc text NOT NULL,
    issue_ref text,
    break_months date[],
    location_pattern text,
    CONSTRAINT known_issues_check CHECK (((variable_id IS NOT NULL) OR (variable_pattern IS NOT NULL))),
    CONSTRAINT known_issues_kind_check CHECK ((kind = ANY (ARRAY['discontinuity'::text, 'product_disagreement'::text, 'missing_composites'::text, 'auxiliary'::text, 'sampling_change'::text, 'no_data'::text])))
);


--
-- Name: locations; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.locations (
    id text NOT NULL,
    kind text NOT NULL,
    location_group text,
    name_zh text,
    name_en text,
    lat double precision,
    lon double precision,
    bbox_w double precision,
    bbox_s double precision,
    bbox_e double precision,
    bbox_n double precision,
    tier text NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT locations_tier_check CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text, 'observed'::text])))
);


--
-- Name: search_documents; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.search_documents (
    doc_id integer NOT NULL,
    kind text NOT NULL,
    ref_id text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    CONSTRAINT search_documents_kind_check CHECK ((kind = ANY (ARRAY['variable'::text, 'product'::text, 'known_issue'::text])))
);


--
-- Name: search_documents_doc_id_seq; Type: SEQUENCE; Schema: meta; Owner: -
--

ALTER TABLE meta.search_documents ALTER COLUMN doc_id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME meta.search_documents_doc_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: series_known_issues; Type: VIEW; Schema: meta; Owner: -
--

CREATE VIEW meta.series_known_issues AS
 SELECT s.series_id,
    s.variable_id,
    s.location_id,
    s.aggregation,
    k.id AS issue_id,
    k.kind,
    k.period_start,
    k.period_end,
    k.flag_months,
    k.summary_en,
    k.source_doc
   FROM (meta.series s
     JOIN meta.known_issues k ON ((((k.aggregation IS NULL) OR (k.aggregation = s.aggregation)) AND ((k.location_pattern IS NULL) OR (s.location_id ~ k.location_pattern)) AND (((k.variable_id IS NOT NULL) AND (k.variable_id = s.variable_id)) OR ((k.variable_id IS NULL) AND (s.variable_id ~ k.variable_pattern))))));


--
-- Name: sources; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.sources (
    id text NOT NULL,
    raw_table text,
    description_en text NOT NULL
);


--
-- Name: yearly_mean; Type: VIEW; Schema: obs; Owner: -
--

CREATE VIEW obs.yearly_mean AS
 SELECT series_id,
    year,
    mean_value,
    n_months
   FROM _timescaledb_internal._materialized_hypertable_2;


--
-- Name: appeears; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.appeears (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: file_planetary_computer_modis_lst; Type: FOREIGN TABLE; Schema: raw; Owner: -
--

CREATE FOREIGN TABLE raw.file_planetary_computer_modis_lst (
    date date,
    location_id text,
    asset text,
    count integer,
    mean double precision,
    standard_deviation double precision,
    minimum double precision,
    maximum double precision,
    pixels_in_bbox integer,
    tiles text,
    item_ids text
)
SERVER raw_files
OPTIONS (
    filename '/data/raw/planetary_computer/modis_lst/stats.csv',
    format 'csv',
    header 'true'
);


--
-- Name: file_planetary_computer_modis_lst_pc; Type: FOREIGN TABLE; Schema: raw; Owner: -
--

CREATE FOREIGN TABLE raw.file_planetary_computer_modis_lst_pc (
    date date,
    location_id text,
    asset text,
    count integer,
    mean double precision,
    standard_deviation double precision,
    minimum double precision,
    maximum double precision,
    pixels_in_bbox integer,
    tiles text,
    item_ids text
)
SERVER raw_files
OPTIONS (
    filename '/data/raw/planetary_computer/modis_lst_pc/stats.csv',
    format 'csv',
    header 'true'
);


--
-- Name: file_planetary_computer_modis_ndvi; Type: FOREIGN TABLE; Schema: raw; Owner: -
--

CREATE FOREIGN TABLE raw.file_planetary_computer_modis_ndvi (
    date date,
    location_id text,
    asset text,
    count integer,
    mean double precision,
    standard_deviation double precision,
    minimum double precision,
    maximum double precision,
    pixels_in_bbox integer,
    tiles text,
    item_ids text
)
SERVER raw_files
OPTIONS (
    filename '/data/raw/planetary_computer/modis_ndvi/stats.csv',
    format 'csv',
    header 'true'
);


--
-- Name: file_planetary_computer_modis_ndvi_pc; Type: FOREIGN TABLE; Schema: raw; Owner: -
--

CREATE FOREIGN TABLE raw.file_planetary_computer_modis_ndvi_pc (
    date date,
    location_id text,
    asset text,
    count integer,
    mean double precision,
    standard_deviation double precision,
    minimum double precision,
    maximum double precision,
    pixels_in_bbox integer,
    tiles text,
    item_ids text
)
SERVER raw_files
OPTIONS (
    filename '/data/raw/planetary_computer/modis_ndvi_pc/stats.csv',
    format 'csv',
    header 'true'
);


--
-- Name: file_planetary_computer; Type: VIEW; Schema: raw; Owner: -
--

CREATE VIEW raw.file_planetary_computer AS
 SELECT 'modis_lst_pc'::text AS variable_id,
    f.date,
    f.location_id,
    f.asset,
    f.count,
    f.mean,
    f.standard_deviation,
    f.minimum,
    f.maximum,
    f.pixels_in_bbox,
    f.tiles,
    f.item_ids
   FROM raw.file_planetary_computer_modis_lst_pc f
UNION ALL
 SELECT 'modis_ndvi_pc'::text AS variable_id,
    f.date,
    f.location_id,
    f.asset,
    f.count,
    f.mean,
    f.standard_deviation,
    f.minimum,
    f.maximum,
    f.pixels_in_bbox,
    f.tiles,
    f.item_ids
   FROM raw.file_planetary_computer_modis_ndvi_pc f
UNION ALL
 SELECT 'modis_lst'::text AS variable_id,
    f.date,
    f.location_id,
    f.asset,
    f.count,
    f.mean,
    f.standard_deviation,
    f.minimum,
    f.maximum,
    f.pixels_in_bbox,
    f.tiles,
    f.item_ids
   FROM raw.file_planetary_computer_modis_lst f
UNION ALL
 SELECT 'modis_ndvi'::text AS variable_id,
    f.date,
    f.location_id,
    f.asset,
    f.count,
    f.mean,
    f.standard_deviation,
    f.minimum,
    f.maximum,
    f.pixels_in_bbox,
    f.tiles,
    f.item_ids
   FROM raw.file_planetary_computer_modis_ndvi f;


--
-- Name: giovanni; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.giovanni (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: grid; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.grid (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: harmony; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.harmony (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: nasa_power; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.nasa_power (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: noaa_ghcnh; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.noaa_ghcnh (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: planetary_computer; Type: TABLE; Schema: raw; Owner: -
--

CREATE TABLE raw.planetary_computer (
    variable_id text NOT NULL,
    location_id text NOT NULL,
    obs_key text NOT NULL,
    value double precision,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: correlation_edges correlation_edges_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.correlation_edges
    ADD CONSTRAINT correlation_edges_pkey PRIMARY KEY (table_kind, edge_id);


--
-- Name: correlation_nodes correlation_nodes_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.correlation_nodes
    ADD CONSTRAINT correlation_nodes_pkey PRIMARY KEY (table_kind, node_id);


--
-- Name: gap_stats gap_stats_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.gap_stats
    ADD CONSTRAINT gap_stats_pkey PRIMARY KEY (run_id, "grouping", model_variable, group_value);


--
-- Name: gap_tree_folds gap_tree_folds_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.gap_tree_folds
    ADD CONSTRAINT gap_tree_folds_pkey PRIMARY KEY (run_id, variant, validation, fold);


--
-- Name: mining_rules mining_rules_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.mining_rules
    ADD CONSTRAINT mining_rules_pkey PRIMARY KEY (run_id, table_kind, timing, rule_set, rank);


--
-- Name: mining_runs mining_runs_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.mining_runs
    ADD CONSTRAINT mining_runs_pkey PRIMARY KEY (run_id, kind);


--
-- Name: mining_wide_point mining_wide_point_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.mining_wide_point
    ADD CONSTRAINT mining_wide_point_pkey PRIMARY KEY (location_id, month);


--
-- Name: mining_wide_region mining_wide_region_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.mining_wide_region
    ADD CONSTRAINT mining_wide_region_pkey PRIMARY KEY (location_id, month);


--
-- Name: model_obs_pairs model_obs_pairs_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_pkey PRIMARY KEY (pair_id);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (run_id);


--
-- Name: series_embeddings series_embeddings_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.series_embeddings
    ADD CONSTRAINT series_embeddings_pkey PRIMARY KEY (series_id);


--
-- Name: tree_folds tree_folds_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.tree_folds
    ADD CONSTRAINT tree_folds_pkey PRIMARY KEY (run_id, variant, fold);


--
-- Name: trends trends_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.trends
    ADD CONSTRAINT trends_pkey PRIMARY KEY (series_id);


--
-- Name: variable_graph_nodes variable_graph_nodes_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.variable_graph_nodes
    ADD CONSTRAINT variable_graph_nodes_pkey PRIMARY KEY (node_id);


--
-- Name: variable_graph_nodes variable_graph_nodes_variable_id_key; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.variable_graph_nodes
    ADD CONSTRAINT variable_graph_nodes_variable_id_key UNIQUE (variable_id);


--
-- Name: variable_graph variable_graph_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.variable_graph
    ADD CONSTRAINT variable_graph_pkey PRIMARY KEY (edge_id);


--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: clean; Owner: -
--

ALTER TABLE ONLY clean.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (series_id, month);


--
-- Name: series_summary series_summary_pkey; Type: CONSTRAINT; Schema: clean; Owner: -
--

ALTER TABLE ONLY clean.series_summary
    ADD CONSTRAINT series_summary_pkey PRIMARY KEY (series_id);


--
-- Name: annual_mean_rasters annual_mean_rasters_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.annual_mean_rasters
    ADD CONSTRAINT annual_mean_rasters_pkey PRIMARY KEY (variable_id, year);


--
-- Name: grid_cells grid_cells_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.grid_cells
    ADD CONSTRAINT grid_cells_pkey PRIMARY KEY (variable_id, lat, lon);


--
-- Name: grid_layers grid_layers_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.grid_layers
    ADD CONSTRAINT grid_layers_pkey PRIMARY KEY (variable_id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (location_id);


--
-- Name: monthly_rasters monthly_rasters_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.monthly_rasters
    ADD CONSTRAINT monthly_rasters_pkey PRIMARY KEY (variable_id, month);


--
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (location_id);


--
-- Name: trend_rasters trend_rasters_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.trend_rasters
    ADD CONSTRAINT trend_rasters_pkey PRIMARY KEY (variable_id);


--
-- Name: cleaning_rules cleaning_rules_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.cleaning_rules
    ADD CONSTRAINT cleaning_rules_pkey PRIMARY KEY (name);


--
-- Name: known_issues known_issues_no_overlap; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.known_issues
    ADD CONSTRAINT known_issues_no_overlap EXCLUDE USING gist (variable_id WITH =, COALESCE(aggregation, '*'::text) WITH =, daterange(period_start, period_end, '[]'::text) WITH &&) WHERE ((flag_months AND (variable_id IS NOT NULL)));


--
-- Name: known_issues known_issues_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.known_issues
    ADD CONSTRAINT known_issues_pkey PRIMARY KEY (id);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: search_documents search_documents_kind_ref_id_key; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.search_documents
    ADD CONSTRAINT search_documents_kind_ref_id_key UNIQUE (kind, ref_id);


--
-- Name: search_documents search_documents_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.search_documents
    ADD CONSTRAINT search_documents_pkey PRIMARY KEY (doc_id);


--
-- Name: series series_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.series
    ADD CONSTRAINT series_pkey PRIMARY KEY (series_id);


--
-- Name: series series_variable_id_location_id_aggregation_key; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.series
    ADD CONSTRAINT series_variable_id_location_id_aggregation_key UNIQUE (variable_id, location_id, aggregation);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (id);


--
-- Name: variables variables_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.variables
    ADD CONSTRAINT variables_pkey PRIMARY KEY (id);


--
-- Name: observations observations_pkey; Type: CONSTRAINT; Schema: obs; Owner: -
--

ALTER TABLE ONLY obs.observations
    ADD CONSTRAINT observations_pkey PRIMARY KEY (series_id, month);


--
-- Name: appeears appeears_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.appeears
    ADD CONSTRAINT appeears_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: giovanni giovanni_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.giovanni
    ADD CONSTRAINT giovanni_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: grid grid_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.grid
    ADD CONSTRAINT grid_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: harmony harmony_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.harmony
    ADD CONSTRAINT harmony_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: nasa_power nasa_power_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.nasa_power
    ADD CONSTRAINT nasa_power_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: noaa_ghcnh noaa_ghcnh_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.noaa_ghcnh
    ADD CONSTRAINT noaa_ghcnh_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: planetary_computer planetary_computer_pkey; Type: CONSTRAINT; Schema: raw; Owner: -
--

ALTER TABLE ONLY raw.planetary_computer
    ADD CONSTRAINT planetary_computer_pkey PRIMARY KEY (variable_id, location_id, obs_key);


--
-- Name: mining_rules_antecedents_gin; Type: INDEX; Schema: analysis; Owner: -
--

CREATE INDEX mining_rules_antecedents_gin ON analysis.mining_rules USING gin (antecedents);


--
-- Name: model_obs_pairs_by_location; Type: INDEX; Schema: analysis; Owner: -
--

CREATE INDEX model_obs_pairs_by_location ON analysis.model_obs_pairs USING btree (location_id);


--
-- Name: series_embeddings_hnsw; Type: INDEX; Schema: analysis; Owner: -
--

CREATE INDEX series_embeddings_hnsw ON analysis.series_embeddings USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: trends_significant; Type: INDEX; Schema: analysis; Owner: -
--

CREATE INDEX trends_significant ON analysis.trends USING btree (ols_significant_fdr) WHERE ols_significant_fdr;


--
-- Name: clean_observations_flagged; Type: INDEX; Schema: clean; Owner: -
--

CREATE INDEX clean_observations_flagged ON clean.observations USING btree (qc_flag, series_id) WHERE (qc_flag <> 'ok'::text);


--
-- Name: monthly_climatology_key; Type: INDEX; Schema: clean; Owner: -
--

CREATE UNIQUE INDEX monthly_climatology_key ON clean.monthly_climatology USING btree (series_id, calendar_month);


--
-- Name: annual_mean_rasters_hull_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX annual_mean_rasters_hull_gist ON geo.annual_mean_rasters USING gist (public.st_convexhull(rast));


--
-- Name: grid_cells_centre_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX grid_cells_centre_gist ON geo.grid_cells USING gist (centre);


--
-- Name: grid_cells_h3; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX grid_cells_h3 ON geo.grid_cells USING btree (h3_res3, variable_id);


--
-- Name: h3_trends_key; Type: INDEX; Schema: geo; Owner: -
--

CREATE UNIQUE INDEX h3_trends_key ON geo.h3_trends USING btree (resolution, h3, variable_id);


--
-- Name: locations_geom_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX locations_geom_gist ON geo.locations USING gist (geom);


--
-- Name: regions_geom_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX regions_geom_gist ON geo.regions USING gist (geom);


--
-- Name: trend_rasters_hull_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX trend_rasters_hull_gist ON geo.trend_rasters USING gist (public.st_convexhull(rast));


--
-- Name: search_documents_bm25; Type: INDEX; Schema: meta; Owner: -
--

CREATE INDEX search_documents_bm25 ON meta.search_documents USING bm25 (body) WITH (text_config=english);


--
-- Name: series_by_location; Type: INDEX; Schema: meta; Owner: -
--

CREATE INDEX series_by_location ON meta.series USING btree (location_id);


--
-- Name: series_request_gin; Type: INDEX; Schema: meta; Owner: -
--

CREATE INDEX series_request_gin ON meta.series USING gin (request jsonb_path_ops);


--
-- Name: variables_attributes_gin; Type: INDEX; Schema: meta; Owner: -
--

CREATE INDEX variables_attributes_gin ON meta.variables USING gin (attributes);


--
-- Name: variables_category_gist; Type: INDEX; Schema: meta; Owner: -
--

CREATE INDEX variables_category_gist ON meta.variables USING gist (category_path);


--
-- Name: variables_name_trgm; Type: INDEX; Schema: meta; Owner: -
--

CREATE INDEX variables_name_trgm ON meta.variables USING gin ((((id || ' '::text) || COALESCE(name_en, ''::text))) public.gin_trgm_ops);


--
-- Name: observations_month_idx; Type: INDEX; Schema: obs; Owner: -
--

CREATE INDEX observations_month_idx ON obs.observations USING btree (month DESC);


--
-- Name: appeears_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX appeears_payload_gin ON raw.appeears USING gin (payload jsonb_path_ops);


--
-- Name: giovanni_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX giovanni_payload_gin ON raw.giovanni USING gin (payload jsonb_path_ops);


--
-- Name: grid_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX grid_payload_gin ON raw.grid USING gin (payload jsonb_path_ops);


--
-- Name: harmony_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX harmony_payload_gin ON raw.harmony USING gin (payload jsonb_path_ops);


--
-- Name: nasa_power_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX nasa_power_payload_gin ON raw.nasa_power USING gin (payload jsonb_path_ops);


--
-- Name: noaa_ghcnh_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX noaa_ghcnh_payload_gin ON raw.noaa_ghcnh USING gin (payload jsonb_path_ops);


--
-- Name: planetary_computer_payload_gin; Type: INDEX; Schema: raw; Owner: -
--

CREATE INDEX planetary_computer_payload_gin ON raw.planetary_computer USING gin (payload jsonb_path_ops);


--
-- Name: gap_stats gap_stats_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.gap_stats
    ADD CONSTRAINT gap_stats_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: gap_tree_folds gap_tree_folds_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.gap_tree_folds
    ADD CONSTRAINT gap_tree_folds_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: mining_rules mining_rules_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.mining_rules
    ADD CONSTRAINT mining_rules_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: mining_runs mining_runs_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.mining_runs
    ADD CONSTRAINT mining_runs_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: model_obs_pairs model_obs_pairs_location_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_location_id_fkey FOREIGN KEY (location_id) REFERENCES meta.locations(id);


--
-- Name: model_obs_pairs model_obs_pairs_model_series_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_model_series_id_fkey FOREIGN KEY (model_series_id) REFERENCES meta.series(series_id);


--
-- Name: model_obs_pairs model_obs_pairs_model_variable_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_model_variable_id_fkey FOREIGN KEY (model_variable_id) REFERENCES meta.variables(id);


--
-- Name: model_obs_pairs model_obs_pairs_obs_series_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_obs_series_id_fkey FOREIGN KEY (obs_series_id) REFERENCES meta.series(series_id);


--
-- Name: model_obs_pairs model_obs_pairs_obs_variable_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_obs_variable_id_fkey FOREIGN KEY (obs_variable_id) REFERENCES meta.variables(id);


--
-- Name: model_obs_pairs model_obs_pairs_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.model_obs_pairs
    ADD CONSTRAINT model_obs_pairs_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: series_embeddings series_embeddings_series_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.series_embeddings
    ADD CONSTRAINT series_embeddings_series_id_fkey FOREIGN KEY (series_id) REFERENCES meta.series(series_id);


--
-- Name: tree_folds tree_folds_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.tree_folds
    ADD CONSTRAINT tree_folds_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: trends trends_run_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.trends
    ADD CONSTRAINT trends_run_id_fkey FOREIGN KEY (run_id) REFERENCES analysis.runs(run_id);


--
-- Name: trends trends_series_id_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.trends
    ADD CONSTRAINT trends_series_id_fkey FOREIGN KEY (series_id) REFERENCES meta.series(series_id);


--
-- Name: variable_graph variable_graph_source_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.variable_graph
    ADD CONSTRAINT variable_graph_source_fkey FOREIGN KEY (source) REFERENCES analysis.variable_graph_nodes(node_id);


--
-- Name: variable_graph variable_graph_target_fkey; Type: FK CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.variable_graph
    ADD CONSTRAINT variable_graph_target_fkey FOREIGN KEY (target) REFERENCES analysis.variable_graph_nodes(node_id);


--
-- Name: observations observations_series_id_fkey; Type: FK CONSTRAINT; Schema: clean; Owner: -
--

ALTER TABLE ONLY clean.observations
    ADD CONSTRAINT observations_series_id_fkey FOREIGN KEY (series_id) REFERENCES meta.series(series_id);


--
-- Name: series_summary series_summary_series_id_fkey; Type: FK CONSTRAINT; Schema: clean; Owner: -
--

ALTER TABLE ONLY clean.series_summary
    ADD CONSTRAINT series_summary_series_id_fkey FOREIGN KEY (series_id) REFERENCES meta.series(series_id);


--
-- Name: annual_mean_rasters annual_mean_rasters_variable_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.annual_mean_rasters
    ADD CONSTRAINT annual_mean_rasters_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id);


--
-- Name: grid_cells grid_cells_variable_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.grid_cells
    ADD CONSTRAINT grid_cells_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id);


--
-- Name: locations locations_location_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.locations
    ADD CONSTRAINT locations_location_id_fkey FOREIGN KEY (location_id) REFERENCES meta.locations(id);


--
-- Name: monthly_rasters monthly_rasters_variable_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.monthly_rasters
    ADD CONSTRAINT monthly_rasters_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id);


--
-- Name: regions regions_location_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.regions
    ADD CONSTRAINT regions_location_id_fkey FOREIGN KEY (location_id) REFERENCES meta.locations(id);


--
-- Name: trend_rasters trend_rasters_variable_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.trend_rasters
    ADD CONSTRAINT trend_rasters_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES geo.grid_layers(variable_id);


--
-- Name: series series_location_id_fkey; Type: FK CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.series
    ADD CONSTRAINT series_location_id_fkey FOREIGN KEY (location_id) REFERENCES meta.locations(id);


--
-- Name: series series_source_api_fkey; Type: FK CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.series
    ADD CONSTRAINT series_source_api_fkey FOREIGN KEY (source_api) REFERENCES meta.sources(id);


--
-- Name: series series_variable_id_fkey; Type: FK CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.series
    ADD CONSTRAINT series_variable_id_fkey FOREIGN KEY (variable_id) REFERENCES meta.variables(id);


--
-- Name: observations observations_series_id_fkey; Type: FK CONSTRAINT; Schema: obs; Owner: -
--

ALTER TABLE ONLY obs.observations
    ADD CONSTRAINT observations_series_id_fkey FOREIGN KEY (series_id) REFERENCES meta.series(series_id);


--
-- PostgreSQL database dump complete
--
