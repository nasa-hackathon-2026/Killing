-- pg_textsearch（#91）：BM25 全文搜尋，搜變數名稱與定義、產品與引用、已知問題的說明。
-- 需要 shared_preload_libraries 有 pg_textsearch（這個映像預設就有）。
-- 和 meta.search_variables（pg_trgm）的差別：trigram 比字形，拼錯也找得到，只看 id 與英文名；
-- BM25 比詞（英文詞幹），多個詞的查詢會依詞頻與文件長度排序，內容包含定義、產品、引用與已知問題。
CREATE EXTENSION IF NOT EXISTS pg_textsearch;

CREATE TABLE IF NOT EXISTS meta.search_documents (
    doc_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('variable', 'product', 'known_issue')),
    ref_id text NOT NULL,     -- 變數 id、產品名稱或已知問題的 id
    title text NOT NULL,
    body text NOT NULL,
    UNIQUE (kind, ref_id)
);
CREATE INDEX IF NOT EXISTS search_documents_bm25 ON meta.search_documents
    USING bm25 (body) WITH (text_config = 'english');

-- 由 meta.variables 與 meta.known_issues 重建文件。回傳文件數。
CREATE OR REPLACE FUNCTION meta.refresh_search_documents()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    n integer;
BEGIN
    TRUNCATE meta.search_documents RESTART IDENTITY;
    INSERT INTO meta.search_documents (kind, ref_id, title, body)
    SELECT 'variable', v.id, coalesce(v.name_en, v.id),
           concat_ws(' ', replace(v.id, '_', ' '), v.name_en, v.unit, v.product,
                     replace(v.category_path::text, '.', ' '), v.data_kind,
                     replace(v.data_kind, '_', ' '), v.data_kind_note)
    FROM meta.variables v
    UNION ALL
    SELECT 'product', v.product, v.product,
           concat_ws(' ', v.product, max(v.citation), max(v.doi), max(v.source),
                     string_agg(v.name_en, '; ' ORDER BY v.id))
    FROM meta.variables v
    WHERE v.product IS NOT NULL
    GROUP BY v.product
    UNION ALL
    SELECT 'known_issue', k.id, k.kind || ': ' || coalesce(k.variable_id, k.variable_pattern),
           concat_ws(' ', k.summary_en, replace(k.kind, '_', ' '),
                     replace(coalesce(k.variable_id, ''), '_', ' '), k.source_doc)
    FROM meta.known_issues k;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-- BM25 搜尋。pg_textsearch 的 <@> 回傳「負的 BM25 分數」（越小越相關），這裡轉成正的 score。
CREATE OR REPLACE FUNCTION meta.search_text(p_query text, p_limit integer DEFAULT 10)
RETURNS TABLE (kind text, ref_id text, title text, score double precision)
LANGUAGE sql STABLE AS $$
    SELECT d.kind, d.ref_id, d.title,
           -(d.body <@> to_bm25query(p_query, 'meta.search_documents_bm25')) AS score
    FROM meta.search_documents d
    WHERE d.body <@> to_bm25query(p_query, 'meta.search_documents_bm25') < 0
    ORDER BY d.body <@> to_bm25query(p_query, 'meta.search_documents_bm25'), d.kind, d.ref_id
    LIMIT p_limit;
$$;
