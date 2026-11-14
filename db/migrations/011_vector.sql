-- pgvector（#91）：每條序列一個向量，找變化型態最像的序列。
-- 向量是 2005-01 至 2025-08 共 248 個月的距平（缺月用補值政策的結果 anomaly_filled），
-- 再標準化成平均 0、標準差 1；所以 cosine 相似度就是這 248 個月距平的 Pearson 相關係數。
-- 期間的選法：符合探勘條件的 6,569 條序列全部涵蓋這段期間（AIRS 從 2002-09、OMI 從 2004-10
-- 起，IMERG Final 只到 2025-09）；若用 2001-01 至 2025-12（300 個月）只剩 2,789 條、118 個變數，
-- AIRS、OMI、IMERG 全部不在（2026-11-15 實測）。要改期間就改這個檔的日期與維度，再重跑。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS analysis.series_embeddings (
    series_id integer PRIMARY KEY REFERENCES meta.series (series_id),
    first_month date NOT NULL,
    last_month date NOT NULL,
    n_filled integer NOT NULL,           -- 這 248 個月裡補了幾個月
    anomaly_sd double precision NOT NULL, -- 標準化前的標準差（距平的單位）
    embedding vector(248) NOT NULL
);
CREATE INDEX IF NOT EXISTS series_embeddings_hnsw ON analysis.series_embeddings
    USING hnsw (embedding vector_cosine_ops);

-- 重建全部向量。不建的序列：不符合探勘條件（補值比例超過 max_fill_fraction）、
-- 這 248 個月裡有任何一個月沒有 anomaly_filled（期間沒有涵蓋）、或距平沒有變化（標準差 0）。
CREATE OR REPLACE FUNCTION analysis.refresh_series_embeddings()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    n integer;
BEGIN
    TRUNCATE analysis.series_embeddings;
    INSERT INTO analysis.series_embeddings
    SELECT w.series_id, min(w.month), max(w.month),
           count(w.fill_method)::integer, min(w.sd),
           array_agg((w.anomaly_filled - w.mean) / w.sd ORDER BY w.month)::vector(248)
    FROM (
        SELECT o.series_id, o.month, o.anomaly_filled, o.fill_method,
               avg(o.anomaly_filled) OVER series AS mean,
               stddev_pop(o.anomaly_filled) OVER series AS sd,
               count(o.anomaly_filled) OVER series AS n
        FROM clean.observations o
        JOIN clean.series_summary q USING (series_id)
        WHERE q.mining_eligible
          AND o.month BETWEEN DATE '2005-01-01' AND DATE '2025-08-01'
        WINDOW series AS (PARTITION BY o.series_id)
    ) w
    WHERE w.n = 248 AND w.sd > 0
    GROUP BY w.series_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    ANALYZE analysis.series_embeddings;
    RETURN n;
END $$;

-- 探勘用的「同一個物理量」變數組（mining.py 的 same_quantity_groups），讀最近一次探勘的參數
CREATE OR REPLACE VIEW analysis.same_quantity_groups AS
SELECT g.group_id::integer AS group_id, m.variable_id
FROM (
    SELECT parameters FROM analysis.mining_runs
    WHERE parameters ? 'same_quantity_groups'
    ORDER BY run_id DESC LIMIT 1
) r
CROSS JOIN LATERAL jsonb_array_elements(r.parameters -> 'same_quantity_groups')
    WITH ORDINALITY AS g (members, group_id)
CROSS JOIN LATERAL jsonb_array_elements_text(g.members) AS m (variable_id);

-- 與某條序列變化型態最像的 k 條序列（cosine 相似度由高到低）。p_filters 的鍵（都可省略）：
--   different_variable、different_location、exclude_same_quantity（排除探勘的同量變數組）、
--   exclude_same_category（排除 ltree 分類相同的變數）、exclude_auxiliary：true 才生效
--   tier、aggregation：只留這一種；category：只留這個 ltree 子樹底下的變數
-- hnsw.iterative_scan 讓篩選條件很嚴時索引會繼續往下找，仍回得出 k 條。
CREATE OR REPLACE FUNCTION analysis.similar_series(
    p_series_id integer, p_k integer DEFAULT 10, p_filters jsonb DEFAULT '{}')
RETURNS TABLE (series_id integer, variable_id text, location_id text, aggregation text,
               tier text, cosine_similarity double precision, n_filled integer)
LANGUAGE sql STABLE
SET hnsw.iterative_scan = 'strict_order'
AS $$
    WITH target AS MATERIALIZED (
        SELECT s.variable_id, s.location_id, v.category_path
        FROM meta.series s JOIN meta.variables v ON v.id = s.variable_id
        WHERE s.series_id = p_series_id
    )
    SELECT e.series_id, s.variable_id, s.location_id, s.aggregation, s.tier,
           1 - (e.embedding <=> (SELECT q.embedding FROM analysis.series_embeddings q
                                 WHERE q.series_id = p_series_id)),
           e.n_filled
    FROM analysis.series_embeddings e
    JOIN meta.series s USING (series_id)
    JOIN meta.variables v ON v.id = s.variable_id
    WHERE e.series_id <> p_series_id
      AND (NOT coalesce((p_filters ->> 'different_variable')::boolean, false)
           OR s.variable_id <> (SELECT t.variable_id FROM target t))
      AND (NOT coalesce((p_filters ->> 'different_location')::boolean, false)
           OR s.location_id <> (SELECT t.location_id FROM target t))
      AND (NOT coalesce((p_filters ->> 'exclude_same_quantity')::boolean, false)
           OR NOT EXISTS (
               SELECT 1 FROM analysis.same_quantity_groups a
               JOIN analysis.same_quantity_groups b USING (group_id)
               WHERE a.variable_id = (SELECT t.variable_id FROM target t)
                 AND b.variable_id = s.variable_id))
      AND (NOT coalesce((p_filters ->> 'exclude_same_category')::boolean, false)
           OR v.category_path IS DISTINCT FROM (SELECT t.category_path FROM target t))
      AND (NOT coalesce((p_filters ->> 'exclude_auxiliary')::boolean, false)
           OR NOT v.is_auxiliary)
      AND (p_filters ->> 'tier' IS NULL OR s.tier = p_filters ->> 'tier')
      AND (p_filters ->> 'aggregation' IS NULL OR s.aggregation = p_filters ->> 'aggregation')
      AND (p_filters ->> 'category' IS NULL
           OR v.category_path <@ (p_filters ->> 'category')::ltree)
    ORDER BY e.embedding <=> (SELECT q.embedding FROM analysis.series_embeddings q
                              WHERE q.series_id = p_series_id)
    LIMIT p_k;
$$;
