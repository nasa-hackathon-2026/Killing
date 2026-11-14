-- pg_cron（#91）：每天重新整理由清洗結果衍生的 materialized view。
-- pg_cron 要在伺服器啟動時載入（shared_preload_libraries）而且只能建在 cron.database_name 指定的
-- 那一個資料庫；db/compose.yaml 的 command 設了這兩項。沒有這樣啟動的伺服器、或不是那個資料庫
-- （例如測試用的 trend_detective_test），這個 migration 只建函式，不建擴充也不排程。
-- 停用：SELECT cron.unschedule('trend-detective-daily-refresh');
--       要連擴充一起拿掉：DROP EXTENSION pg_cron，並把 compose 的 command 拿掉後重建容器。
CREATE OR REPLACE FUNCTION clean.refresh_derived()
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW clean.monthly_climatology;
    REFRESH MATERIALIZED VIEW geo.h3_trends;
END $$;

DO $$
BEGIN
    IF current_setting('shared_preload_libraries') LIKE '%pg_cron%'
       AND current_setting('cron.database_name', true) = current_database() THEN
        CREATE EXTENSION IF NOT EXISTS pg_cron;
        -- 同名的工作會被更新，不會重複；時間是 UTC（cron.timezone 的預設值）
        PERFORM cron.schedule('trend-detective-daily-refresh', '15 3 * * *',
                              'SELECT clean.refresh_derived()');
    ELSE
        RAISE NOTICE 'pg_cron is not preloaded for this database; no job scheduled';
    END IF;
END $$;
