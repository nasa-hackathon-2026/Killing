-- 清洗結果。原始值不覆蓋：value_raw 與 obs.observations 相同，判斷都寫在旁邊的欄位。
-- 一列是 序列 × 骨架月份（序列第一個到最後一個有列的月份之間每個月都有一列）。
CREATE TABLE IF NOT EXISTS clean.observations (
    series_id integer NOT NULL REFERENCES meta.series (series_id),
    month date NOT NULL,
    in_source boolean NOT NULL,          -- false：骨架補出來的月份，obs.observations 沒有這一列
    value_raw double precision,
    value_clean double precision,        -- missing、partial_month、low_coverage 的月份是 NULL
    qc_flag text NOT NULL CHECK (qc_flag IN
        ('ok', 'low_coverage', 'missing', 'partial_month', 'outlier_suspect', 'known_discontinuity')),
    qc_flags text[] NOT NULL,            -- 全部成立的旗標；qc_flag 是其中優先序最高的
    anomaly double precision,            -- value_clean 減該序列同一個月份的平均
    anomaly_filled double precision,     -- 只給資料探勘用；見 fill_method
    fill_method text CHECK (fill_method IN ('linear', 'climatology')),
    n_samples integer,
    coverage double precision,
    PRIMARY KEY (series_id, month)
);
CREATE INDEX IF NOT EXISTS clean_observations_flagged ON clean.observations (qc_flag, series_id)
    WHERE qc_flag <> 'ok';

CREATE TABLE IF NOT EXISTS clean.series_summary (
    series_id integer PRIMARY KEY REFERENCES meta.series (series_id),
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
    mining_eligible boolean NOT NULL,    -- 補值比例不超過 max_fill_fraction
    auxiliary boolean NOT NULL,
    known_issues text[] NOT NULL,
    detail jsonb NOT NULL                -- 完整摘要（含 n_by_any_flag）
);

-- 每條序列 1 至 12 月的月氣候值（可用月份的平均）。按「一年中的第幾個月」分組，不是時間桶，
-- 所以用一般的 materialized view，不是 continuous aggregate。
CREATE MATERIALIZED VIEW IF NOT EXISTS clean.monthly_climatology AS
SELECT series_id,
       extract(month FROM month)::smallint AS calendar_month,
       avg(value_clean) AS mean_value,
       count(value_clean) AS n_years
FROM clean.observations
WHERE value_clean IS NOT NULL
GROUP BY series_id, extract(month FROM month)
WITH NO DATA;
CREATE UNIQUE INDEX IF NOT EXISTS monthly_climatology_key
    ON clean.monthly_climatology (series_id, calendar_month);

-- 趨勢檢定的輸入（政策 a：不補值）
CREATE OR REPLACE VIEW clean.trend_input AS
SELECT o.series_id, s.variable_id, s.location_id, s.aggregation, s.tier,
       o.month, o.value_clean, o.anomaly, o.qc_flag, o.qc_flags
FROM clean.observations o
JOIN meta.series s USING (series_id)
WHERE o.value_clean IS NOT NULL;

-- 資料探勘的輸入（政策 b：距平上補值；補值比例過高的序列不列）
CREATE OR REPLACE VIEW clean.mining_input AS
SELECT o.series_id, s.variable_id, s.location_id, s.aggregation, s.tier,
       o.month, o.anomaly_filled, o.fill_method
FROM clean.observations o
JOIN meta.series s USING (series_id)
JOIN clean.series_summary q USING (series_id)
WHERE o.anomaly_filled IS NOT NULL AND q.mining_eligible;
