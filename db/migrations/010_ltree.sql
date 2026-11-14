-- ltree（#91）：變數的分類樹。路徑由 data/seed/variable_taxonomy.json 的規則算出（`pg load`），
-- 核心變數人工指定（category_basis = 'manual'），其餘是 'rule:<第幾條>' 或 'unclassified'。
CREATE EXTENSION IF NOT EXISTS ltree;

ALTER TABLE meta.variables ADD COLUMN IF NOT EXISTS category_path ltree;
ALTER TABLE meta.variables ADD COLUMN IF NOT EXISTS category_basis text;
CREATE INDEX IF NOT EXISTS variables_category_gist ON meta.variables USING gist (category_path);

-- 分類樹的每個節點（含中間節點）：底下有幾個變數、幾條序列
CREATE OR REPLACE VIEW meta.category_tree AS
WITH nodes AS (
    SELECT DISTINCT subpath(v.category_path, 0, level) AS path
    FROM meta.variables v, generate_series(1, nlevel(v.category_path)) AS level
    WHERE v.category_path IS NOT NULL
)
SELECT n.path, nlevel(n.path) AS depth,
       count(DISTINCT v.id) AS n_variables,
       count(s.series_id) AS n_series
FROM nodes n
JOIN meta.variables v ON v.category_path <@ n.path
LEFT JOIN meta.series s ON s.variable_id = v.id
GROUP BY n.path;

-- 某個子樹底下的全部序列，例如 meta.series_in_category('land.water')
CREATE OR REPLACE FUNCTION meta.series_in_category(p_path text)
RETURNS TABLE (series_id integer, variable_id text, location_id text, aggregation text,
               tier text, category_path ltree)
LANGUAGE sql STABLE AS $$
    SELECT s.series_id, s.variable_id, s.location_id, s.aggregation, s.tier, v.category_path
    FROM meta.variables v
    JOIN meta.series s ON s.variable_id = v.id
    WHERE v.category_path <@ p_path::ltree
    ORDER BY v.category_path, s.variable_id, s.location_id, s.aggregation;
$$;
