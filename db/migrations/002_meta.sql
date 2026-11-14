CREATE TABLE IF NOT EXISTS meta.sources (
    id text PRIMARY KEY,
    raw_table text,
    description_en text NOT NULL
);

CREATE TABLE IF NOT EXISTS meta.variables (
    id text PRIMARY KEY,
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
    tier text NOT NULL CHECK (tier IN ('core', 'extended')),
    needs_translation boolean NOT NULL DEFAULT false,
    -- 由 meta.known_issues 裡 kind = 'auxiliary' 的規則算出（計數、標準差、變異數、觀測幾何）
    is_auxiliary boolean NOT NULL DEFAULT false,
    -- 其餘各來源不同的欄位（harmony_collection、valid_range、appeears_qa、point_source…）
    attributes jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS variables_attributes_gin ON meta.variables USING gin (attributes);
CREATE INDEX IF NOT EXISTS variables_name_trgm ON meta.variables
    USING gin ((id || ' ' || coalesce(name_en, '')) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS meta.locations (
    id text PRIMARY KEY,
    kind text NOT NULL,              -- point、region、station
    location_group text,            -- taiwan、global、world_region、world_city
    name_zh text,
    name_en text,
    lat double precision,
    lon double precision,
    bbox_w double precision,
    bbox_s double precision,
    bbox_e double precision,
    bbox_n double precision,
    tier text NOT NULL CHECK (tier IN ('core', 'extended')),
    attributes jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS meta.series (
    series_id integer PRIMARY KEY,
    variable_id text NOT NULL REFERENCES meta.variables (id),
    location_id text NOT NULL REFERENCES meta.locations (id),
    aggregation text NOT NULL,
    tier text NOT NULL CHECK (tier IN ('core', 'extended')),
    source_api text NOT NULL REFERENCES meta.sources (id),
    unit text,
    product_version text,
    retrieved_at timestamptz,
    grid_lat double precision,
    grid_lon double precision,
    n_points integer NOT NULL,
    first_month date,
    last_month date,
    -- 各來源形狀不同的查詢參數（collection、bbox、station、tasks、cube_id、權重…）原樣放 JSONB
    request jsonb NOT NULL DEFAULT '{}',
    UNIQUE (variable_id, location_id, aggregation)
);
CREATE INDEX IF NOT EXISTS series_request_gin ON meta.series USING gin (request jsonb_path_ops);
CREATE INDEX IF NOT EXISTS series_by_location ON meta.series (location_id);

-- 已查證的資料問題。來源是 data/seed/cleaning.json；數字與出處見 source_doc。
CREATE TABLE IF NOT EXISTS meta.known_issues (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN
        ('discontinuity', 'product_disagreement', 'missing_composites', 'auxiliary')),
    variable_id text,          -- 完全相符
    variable_pattern text,     -- 或正規表示式（POSIX，~）
    aggregation text,          -- 只適用這一種聚合方式；NULL 是全部
    period_start date,
    period_end date,
    flag_months boolean NOT NULL DEFAULT false,  -- true：期間內的月份標 known_discontinuity
    summary_en text NOT NULL,
    source_doc text NOT NULL,
    issue_ref text,
    CHECK (variable_id IS NOT NULL OR variable_pattern IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS meta.cleaning_rules (
    name text PRIMARY KEY,
    value double precision NOT NULL,
    note_en text
);

-- 每條序列適用哪些已知問題
CREATE OR REPLACE VIEW meta.series_known_issues AS
SELECT s.series_id, s.variable_id, s.location_id, s.aggregation, k.id AS issue_id, k.kind,
       k.period_start, k.period_end, k.flag_months, k.summary_en, k.source_doc
FROM meta.series s
JOIN meta.known_issues k
  ON (k.aggregation IS NULL OR k.aggregation = s.aggregation)
 AND ((k.variable_id IS NOT NULL AND k.variable_id = s.variable_id)
   OR (k.variable_id IS NULL AND s.variable_id ~ k.variable_pattern));

-- pg_trgm：用相似度搜變數（id 加英文名），拼錯或只記得片段也找得到
CREATE OR REPLACE FUNCTION meta.search_variables(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE (id text, name_en text, product text, tier text, is_auxiliary boolean, similarity real)
LANGUAGE sql STABLE AS $$
    SELECT v.id, v.name_en, v.product, v.tier, v.is_auxiliary,
           word_similarity(p_query, v.id || ' ' || coalesce(v.name_en, '')) AS similarity
    FROM meta.variables v
    WHERE p_query <% (v.id || ' ' || coalesce(v.name_en, ''))
    ORDER BY similarity DESC, v.id
    LIMIT p_limit;
$$;
