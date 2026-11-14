-- timescaledb_toolkit（#91）：在 SQL 重算月氣候值、距平與線性內插補值，用來核對 Python 的清洗結果
-- （cleaning.py 仍是唯一的清洗算法；這裡的物件只做獨立的對照，不寫回 clean.*）。
CREATE EXTENSION IF NOT EXISTS timescaledb_toolkit;

-- (a) toolkit 的 stats_agg：每條序列 1 至 12 月的月氣候值、可用年數與標準差
CREATE OR REPLACE VIEW clean.toolkit_climatology AS
SELECT series_id, calendar_month,
       average(summary) AS mean_value,
       num_vals(summary)::bigint AS n_years,
       stddev(summary) AS sd_value
FROM (
    SELECT series_id, extract(month FROM month)::smallint AS calendar_month,
           stats_agg(value_clean) AS summary
    FROM clean.observations
    WHERE value_clean IS NOT NULL
    GROUP BY 1, 2
) s;

-- 距平 = value_clean − 上面的月氣候值；anomaly 是 Python 清洗寫進去的，兩者並排
CREATE OR REPLACE VIEW clean.toolkit_anomalies AS
SELECT o.series_id, o.month, o.value_clean - c.mean_value AS anomaly_sql, o.anomaly
FROM clean.observations o
JOIN clean.toolkit_climatology c
  ON c.series_id = o.series_id AND c.calendar_month = extract(month FROM o.month)
WHERE o.value_clean IS NOT NULL;

-- (b) 在 SQL 重現缺值政策 b：連續缺 ≤ p_max_linear_gap 個月線性內插、更長補 0、頭尾不外推。
-- 內插用 TimescaleDB 的 time_bucket_gapfill + interpolate()。時間軸用「月序」（年 × 12 + 月 − 1，
-- 整數）而不是日期：Python 是照月份的位置等距內插；若用日期，interpolate() 會照實際天數內插，
-- 各月天數不同，結果會差一點（p_calendar_time = true 就是那種算法，只給對照用）。
CREATE OR REPLACE FUNCTION clean.sql_filled_anomalies(
    p_max_linear_gap integer DEFAULT NULL, p_calendar_time boolean DEFAULT false)
RETURNS TABLE (series_id integer, month date, anomaly_filled double precision, fill_method text)
LANGUAGE plpgsql STABLE AS $$
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
