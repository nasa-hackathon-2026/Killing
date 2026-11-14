-- 擴充套件與 schema（#83）。每個 migration 都可以重跑（IF NOT EXISTS／OR REPLACE）。
CREATE EXTENSION IF NOT EXISTS timescaledb;  -- obs.observations 的 hypertable、time_bucket_gapfill、continuous aggregate
CREATE EXTENSION IF NOT EXISTS postgis;      -- geo.*：點位、區域多邊形、趨勢格點與空間查詢
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- meta.search_variables：用相似度搜變數名稱（600 多個，多數只有英文長名）

CREATE SCHEMA IF NOT EXISTS meta;      -- 變數、地點、序列、來源、已知問題、清洗規則
CREATE SCHEMA IF NOT EXISTS raw;       -- 各來源原始粒度的資料，一來源一表
CREATE SCHEMA IF NOT EXISTS obs;       -- 統一的月觀測表（hypertable）
CREATE SCHEMA IF NOT EXISTS clean;     -- 清洗結果：旗標、距平、補值、每條序列的摘要
CREATE SCHEMA IF NOT EXISTS geo;       -- PostGIS：地點、區域、趨勢格點
CREATE SCHEMA IF NOT EXISTS analysis;  -- 每次執行的紀錄，趨勢與探勘的結果
