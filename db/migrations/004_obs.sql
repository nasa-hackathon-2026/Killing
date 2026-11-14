-- 統一的月觀測表：一列是 序列 × 月份，值與序列檔逐值相同。時間欄是月初日期。
CREATE TABLE IF NOT EXISTS obs.observations (
    series_id integer NOT NULL REFERENCES meta.series (series_id),
    month date NOT NULL,
    value_raw double precision,     -- 序列檔裡是 null 的月份這裡也是 NULL
    n_samples integer,
    coverage double precision,
    source_api text NOT NULL,
    tier text NOT NULL,
    PRIMARY KEY (series_id, month)
);
-- TimescaleDB：依月份分 chunk（5 年一塊），時間範圍的查詢只掃相關的 chunk
SELECT create_hypertable('obs.observations', by_range('month', INTERVAL '5 years'),
                         if_not_exists => TRUE);

-- TimescaleDB continuous aggregate：每條序列的逐年平均與當年有值的月數
CREATE MATERIALIZED VIEW IF NOT EXISTS obs.yearly_mean
WITH (timescaledb.continuous) AS
SELECT series_id,
       time_bucket(INTERVAL '1 year', month) AS year,
       avg(value_raw) AS mean_value,
       count(value_raw) AS n_months
FROM obs.observations
GROUP BY series_id, time_bucket(INTERVAL '1 year', month)
WITH NO DATA;

-- TimescaleDB time_bucket_gapfill：產生每條序列逐月的完整骨架，回傳骨架有、資料無的月份。
--   no_row      這個月在序列的起訖月之間，但沒有列
--   null_value  有列，值是 NULL
CREATE OR REPLACE FUNCTION obs.missing_months()
RETURNS TABLE (series_id integer, month date, missing_kind text)
LANGUAGE plpgsql STABLE AS $$
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
