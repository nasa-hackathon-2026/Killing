-- 觀測來源與「模式推算 vs 觀測」（#97）。
-- 觀測來源（GISTEMP、GHCNm、台灣 GHCNh 測站、SMAP）是第三層 `tier = 'observed'`：序列檔在
-- data/observed/（不進 git），宣告在 data/seed/sources/*.json。統一表的結構不變。
ALTER TABLE meta.variables DROP CONSTRAINT IF EXISTS variables_tier_check;
ALTER TABLE meta.variables ADD CONSTRAINT variables_tier_check
    CHECK (tier IN ('core', 'extended', 'observed'));
ALTER TABLE meta.locations DROP CONSTRAINT IF EXISTS locations_tier_check;
ALTER TABLE meta.locations ADD CONSTRAINT locations_tier_check
    CHECK (tier IN ('core', 'extended', 'observed'));
ALTER TABLE meta.series DROP CONSTRAINT IF EXISTS series_tier_check;
ALTER TABLE meta.series ADD CONSTRAINT series_tier_check
    CHECK (tier IN ('core', 'extended', 'observed'));

-- 已知問題多兩種：sampling_change（觀測頻率或時刻組成改變）、no_data（這個來源在這裡沒有可用資料）；
-- 並且可以只適用某些地點（location_pattern，POSIX 正規表示式；NULL 是全部地點）。
ALTER TABLE meta.known_issues DROP CONSTRAINT IF EXISTS known_issues_kind_check;
ALTER TABLE meta.known_issues ADD CONSTRAINT known_issues_kind_check
    CHECK (kind IN ('discontinuity', 'product_disagreement', 'missing_composites',
                    'auxiliary', 'sampling_change', 'no_data'));
ALTER TABLE meta.known_issues ADD COLUMN IF NOT EXISTS location_pattern text;

CREATE OR REPLACE VIEW meta.series_known_issues AS
SELECT s.series_id, s.variable_id, s.location_id, s.aggregation, k.id AS issue_id, k.kind,
       k.period_start, k.period_end, k.flag_months, k.summary_en, k.source_doc
FROM meta.series s
JOIN meta.known_issues k
  ON (k.aggregation IS NULL OR k.aggregation = s.aggregation)
 AND (k.location_pattern IS NULL OR s.location_id ~ k.location_pattern)
 AND ((k.variable_id IS NOT NULL AND k.variable_id = s.variable_id)
   OR (k.variable_id IS NULL AND s.variable_id ~ k.variable_pattern));

-- 模式推算與觀測的配對（規則在 data/seed/model_obs_pairs.json；`pg pairs` 整批換新）。
-- 每一列是同一地點、同一個物理量的一條模式序列與一條觀測序列，在共同期間各自取月氣候值算距平後的統計量。
-- 模式那一邊不一定是 meta.series 裡的序列：測站座標所在格的月值直接從格點立方體取（model_source = 'grid_cube_cell'），
-- 這時 model_series_id 是 NULL，取法在 model_detail。
CREATE TABLE IF NOT EXISTS analysis.model_obs_pairs (
    pair_id text PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    pair_group text NOT NULL,             -- taiwan_station、taiwan_gistemp、world_city、global
    quantity text NOT NULL,               -- near_surface_air_temperature
    location_id text NOT NULL REFERENCES meta.locations (id),
    model_variable_id text NOT NULL REFERENCES meta.variables (id),
    model_source text NOT NULL,           -- series、grid_cube_cell
    model_series_id integer REFERENCES meta.series (series_id),
    model_detail jsonb NOT NULL DEFAULT '{}',
    obs_variable_id text NOT NULL REFERENCES meta.variables (id),
    obs_series_id integer NOT NULL REFERENCES meta.series (series_id),
    window_start date NOT NULL,
    window_end date NOT NULL,
    status text NOT NULL,                 -- analyzed、insufficient
    n_common_months integer NOT NULL,
    first_common_month date,
    last_common_month date,
    correlation double precision,         -- 兩條距平的 Pearson 相關
    diff_mean double precision,           -- 模式 − 觀測（距平；共同期間各自去月氣候值，所以接近 0）
    diff_sd double precision,
    diff_rmse double precision,
    model_slope_per_decade double precision,
    model_ci_low double precision,
    model_ci_high double precision,
    obs_slope_per_decade double precision,
    obs_ci_low double precision,
    obs_ci_high double precision,
    slope_difference double precision,    -- 模式 − 觀測
    diff_slope_per_decade double precision,  -- 差值序列本身的趨勢
    diff_ci_low double precision,
    diff_ci_high double precision,
    diff_slope_p double precision,
    diff_slope_significant boolean,
    largest_step double precision,        -- 差值序列前後各 6 個月平均的差，絕對值最大的那一個（含正負號）
    largest_step_month date,              -- 新的一段從這個月開始
    known_issues text[] NOT NULL DEFAULT '{}',
    detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS model_obs_pairs_by_location ON analysis.model_obs_pairs (location_id);
