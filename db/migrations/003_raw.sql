-- 各來源原始粒度的資料，一來源一表（對應 SQLite 的 src_*）。共同欄位是正規欄；各來源才有的
-- 欄位（單位、格點座標、像元數、標準差、tile、item id、測站觀測筆數…）放 payload（JSONB＋GIN）。
--   obs_key：該來源自己的時間鍵（Giovanni／Harmony 的時間戳、POWER 的 YYYYMM、合成期起始日、當地日、月份）
--   value：該列的主要數值（月值、日平均、合成期的區域平均）
DO $$
DECLARE source text;
BEGIN
    FOREACH source IN ARRAY ARRAY['giovanni', 'harmony', 'nasa_power', 'noaa_ghcnh',
                                  'appeears', 'planetary_computer', 'grid'] LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS raw.%I (
                variable_id text NOT NULL,
                location_id text NOT NULL,
                obs_key text NOT NULL,
                value double precision,
                payload jsonb NOT NULL DEFAULT ''{}'',
                PRIMARY KEY (variable_id, location_id, obs_key))', source);
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS %I ON raw.%I USING gin (payload jsonb_path_ops)',
            source || '_payload_gin', source);
    END LOOP;
END $$;
