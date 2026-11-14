-- file_fdw（#91）：把原始檔掛成 foreign table，不載入就能用 SQL 查，並和 raw.* 已載入的值核對。
-- 檔案是 Planetary Computer 的 MODIS 統計 CSV（data/raw/planetary_computer/<變數 id>/stats.csv），
-- 由 db/compose.yaml 以唯讀 volume 掛在容器的 /data/raw/planetary_computer。
-- 檔案在「查詢時」才讀：沒有掛這個目錄的機器照樣能跑 migration，只是查這幾張表會報找不到檔案。
-- file_fdw 讀的是資料庫伺服器看得到的檔案，所以只有超級使用者能建這種表。
CREATE EXTENSION IF NOT EXISTS file_fdw;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'raw_files') THEN
        CREATE SERVER raw_files FOREIGN DATA WRAPPER file_fdw;
    END IF;
END $$;

DO $$
DECLARE
    variable text;
BEGIN
    FOREACH variable IN ARRAY ARRAY['modis_lst_pc', 'modis_ndvi_pc', 'modis_lst', 'modis_ndvi']
    LOOP
        EXECUTE format(
            'CREATE FOREIGN TABLE IF NOT EXISTS raw.%I ('
            ' date date, location_id text, asset text, count integer, mean double precision,'
            ' standard_deviation double precision, minimum double precision,'
            ' maximum double precision, pixels_in_bbox integer, tiles text, item_ids text)'
            ' SERVER raw_files OPTIONS (filename %L, format ''csv'', header ''true'')',
            'file_planetary_computer_' || variable,
            '/data/raw/planetary_computer/' || variable || '/stats.csv');
    END LOOP;
END $$;

-- 四個檔合成一張（多一欄 variable_id）
CREATE OR REPLACE VIEW raw.file_planetary_computer AS
SELECT 'modis_lst_pc' AS variable_id, f.* FROM raw.file_planetary_computer_modis_lst_pc f
UNION ALL
SELECT 'modis_ndvi_pc', f.* FROM raw.file_planetary_computer_modis_ndvi_pc f
UNION ALL
SELECT 'modis_lst', f.* FROM raw.file_planetary_computer_modis_lst f
UNION ALL
SELECT 'modis_ndvi', f.* FROM raw.file_planetary_computer_modis_ndvi f;

-- 原檔與 raw.planetary_computer（load 載入的）逐列核對：只在一邊有的列數、平均值不同的列數
CREATE OR REPLACE FUNCTION raw.check_file_planetary_computer()
RETURNS TABLE (n_file bigint, n_loaded bigint, n_only_in_file bigint, n_only_loaded bigint,
               n_value_differs bigint, max_abs_difference double precision)
LANGUAGE sql STABLE AS $$
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
