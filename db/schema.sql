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
    significance smallint NOT NULL
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
    CONSTRAINT series_tier_check CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text])))
);


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
-- Name: locations; Type: TABLE; Schema: geo; Owner: -
--

CREATE TABLE geo.locations (
    location_id text NOT NULL,
    geom public.geometry(Point,4326) NOT NULL
);


--
-- Name: cleaning_rules; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.cleaning_rules (
    name text NOT NULL,
    value double precision NOT NULL,
    note_en text
);


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
    CONSTRAINT known_issues_check CHECK (((variable_id IS NOT NULL) OR (variable_pattern IS NOT NULL))),
    CONSTRAINT known_issues_kind_check CHECK ((kind = ANY (ARRAY['discontinuity'::text, 'product_disagreement'::text, 'missing_composites'::text, 'auxiliary'::text])))
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
    CONSTRAINT locations_tier_check CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text])))
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
     JOIN meta.known_issues k ON ((((k.aggregation IS NULL) OR (k.aggregation = s.aggregation)) AND (((k.variable_id IS NOT NULL) AND (k.variable_id = s.variable_id)) OR ((k.variable_id IS NULL) AND (s.variable_id ~ k.variable_pattern))))));


--
-- Name: sources; Type: TABLE; Schema: meta; Owner: -
--

CREATE TABLE meta.sources (
    id text NOT NULL,
    raw_table text,
    description_en text NOT NULL
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
    CONSTRAINT variables_tier_check CHECK ((tier = ANY (ARRAY['core'::text, 'extended'::text])))
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
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: analysis; Owner: -
--

ALTER TABLE ONLY analysis.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (run_id);


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
-- Name: regions regions_pkey; Type: CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.regions
    ADD CONSTRAINT regions_pkey PRIMARY KEY (location_id);


--
-- Name: cleaning_rules cleaning_rules_pkey; Type: CONSTRAINT; Schema: meta; Owner: -
--

ALTER TABLE ONLY meta.cleaning_rules
    ADD CONSTRAINT cleaning_rules_pkey PRIMARY KEY (name);


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
-- Name: clean_observations_flagged; Type: INDEX; Schema: clean; Owner: -
--

CREATE INDEX clean_observations_flagged ON clean.observations USING btree (qc_flag, series_id) WHERE (qc_flag <> 'ok'::text);


--
-- Name: monthly_climatology_key; Type: INDEX; Schema: clean; Owner: -
--

CREATE UNIQUE INDEX monthly_climatology_key ON clean.monthly_climatology USING btree (series_id, calendar_month);


--
-- Name: grid_cells_centre_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX grid_cells_centre_gist ON geo.grid_cells USING gist (centre);


--
-- Name: locations_geom_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX locations_geom_gist ON geo.locations USING gist (geom);


--
-- Name: regions_geom_gist; Type: INDEX; Schema: geo; Owner: -
--

CREATE INDEX regions_geom_gist ON geo.regions USING gist (geom);


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
-- Name: regions regions_location_id_fkey; Type: FK CONSTRAINT; Schema: geo; Owner: -
--

ALTER TABLE ONLY geo.regions
    ADD CONSTRAINT regions_location_id_fkey FOREIGN KEY (location_id) REFERENCES meta.locations(id);


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
