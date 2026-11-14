-- pgRouting（#91）：把探勘得到的顯著關聯當成圖。節點是變數，邊是 analysis.mining_rules 裡
-- 通過 BH-FDR 的規則（rule_set = 'rules'，左右不同變數）連起來的一對變數。延遲一個月的規則
-- 左邊的項目是 `prev:<變數>=<狀態>`，這裡去掉 `prev:` 當成同一個變數（邊的 timings 會有 lagged_one_month）。
-- 這是「共同出現」的關聯，不是因果；同量變數與已知問題在節點與邊上有旗標。
CREATE EXTENSION IF NOT EXISTS pgrouting;

CREATE TABLE IF NOT EXISTS analysis.variable_graph_nodes (
    node_id integer PRIMARY KEY,
    variable_id text NOT NULL UNIQUE,
    component integer NOT NULL,          -- 連通分量：分量裡最小的 node_id；沒有邊的節點自成一個
    n_edges integer NOT NULL,
    is_auxiliary boolean NOT NULL,
    same_quantity_group integer,         -- analysis.same_quantity_groups 的組別
    known_issues text[] NOT NULL         -- 適用這個變數的已知問題（不含 auxiliary 那一類）
);

CREATE TABLE IF NOT EXISTS analysis.variable_graph (
    edge_id integer PRIMARY KEY,
    source integer NOT NULL REFERENCES analysis.variable_graph_nodes (node_id),
    target integer NOT NULL REFERENCES analysis.variable_graph_nodes (node_id),
    source_variable text NOT NULL,
    target_variable text NOT NULL,
    n_rules integer NOT NULL,            -- 連起這一對變數的規則數（點位表、區域表、同月與延遲合計）
    table_kinds text[] NOT NULL,
    timings text[] NOT NULL,
    max_lift double precision NOT NULL,  -- 強度：這些規則裡最大的 lift
    min_q double precision NOT NULL,
    cost double precision NOT NULL,      -- 1 / max_lift：關聯越強，路徑上越「近」
    same_quantity boolean NOT NULL       -- 兩端是同一個物理量的變數組
);

-- 由 analysis.mining_rules 重建圖，並用 pgr_connectedComponents 算連通分量。回傳邊數。
CREATE OR REPLACE FUNCTION analysis.refresh_variable_graph()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    n integer;
BEGIN
    TRUNCATE analysis.variable_graph, analysis.variable_graph_nodes;
    -- 節點：規則裡出現過的全部變數（含只出現在持續性規則裡的）
    INSERT INTO analysis.variable_graph_nodes
    SELECT (row_number() OVER (ORDER BY i.variable_id))::integer,
           i.variable_id,
           (row_number() OVER (ORDER BY i.variable_id))::integer,
           0,
           coalesce(v.is_auxiliary, false),
           (SELECT min(g.group_id) FROM analysis.same_quantity_groups g
            WHERE g.variable_id = i.variable_id),
           coalesce((SELECT array_agg(k.id ORDER BY k.id) FROM meta.known_issues k
                     WHERE k.kind <> 'auxiliary'
                       AND ((k.variable_id IS NOT NULL AND k.variable_id = i.variable_id)
                         OR (k.variable_id IS NULL AND i.variable_id ~ k.variable_pattern))),
                    '{}')
    FROM (
        SELECT DISTINCT regexp_replace(split_part(item, '=', 1), '^prev:', '') AS variable_id
        FROM analysis.mining_rules r, unnest(r.antecedents || r.consequent) AS item
    ) i
    LEFT JOIN meta.variables v ON v.id = i.variable_id;

    INSERT INTO analysis.variable_graph
    SELECT (row_number() OVER (ORDER BY p.a, p.b))::integer, na.node_id, nb.node_id, p.a, p.b,
           p.n_rules, p.table_kinds, p.timings, p.max_lift, p.min_q, 1 / p.max_lift,
           coalesce(na.same_quantity_group = nb.same_quantity_group, false)
    FROM (
        SELECT least(x.va, x.vc) AS a, greatest(x.va, x.vc) AS b,
               count(DISTINCT (x.run_id, x.table_kind, x.timing, x.rank))::integer AS n_rules,
               array_agg(DISTINCT x.table_kind ORDER BY x.table_kind) AS table_kinds,
               array_agg(DISTINCT x.timing ORDER BY x.timing) AS timings,
               max(x.lift) AS max_lift, min(x.q) AS min_q
        FROM (
            SELECT r.run_id, r.table_kind, r.timing, r.rank, r.lift, r.q,
                   regexp_replace(split_part(item, '=', 1), '^prev:', '') AS va, split_part(r.consequent, '=', 1) AS vc
            FROM analysis.mining_rules r, unnest(r.antecedents) AS item
            WHERE r.rule_set = 'rules'
        ) x
        WHERE x.va <> x.vc AND x.lift > 0
        GROUP BY 1, 2
    ) p
    JOIN analysis.variable_graph_nodes na ON na.variable_id = p.a
    JOIN analysis.variable_graph_nodes nb ON nb.variable_id = p.b;
    GET DIAGNOSTICS n = ROW_COUNT;

    IF n > 0 THEN
        UPDATE analysis.variable_graph_nodes g
        SET component = c.component
        FROM pgr_connectedComponents(
            'SELECT edge_id AS id, source, target, cost FROM analysis.variable_graph') c
        WHERE c.node = g.node_id;
        UPDATE analysis.variable_graph_nodes g
        SET n_edges = (SELECT count(*) FROM analysis.variable_graph e
                       WHERE g.node_id IN (e.source, e.target));
    END IF;
    RETURN n;
END $$;

-- 各連通分量的變數
CREATE OR REPLACE VIEW analysis.variable_graph_components AS
SELECT component, count(*) AS n_variables,
       array_agg(variable_id ORDER BY variable_id) AS variables,
       array_agg(variable_id ORDER BY variable_id) FILTER (WHERE cardinality(known_issues) > 0)
           AS variables_with_known_issues,
       array_agg(variable_id ORDER BY variable_id) FILTER (WHERE same_quantity_group IS NOT NULL)
           AS variables_in_same_quantity_groups
FROM analysis.variable_graph_nodes
GROUP BY component;

-- 兩個變數之間「成本最小」的關聯路徑（pgr_dijkstra，無向；成本是各邊 1 / max_lift 的和）。
-- 路徑上相鄰的變數有顯著關聯；整條路徑不代表頭尾兩個變數有關聯，更不是因果。
CREATE OR REPLACE FUNCTION analysis.variable_path(p_from text, p_to text)
RETURNS TABLE (seq integer, variable_id text, edge_max_lift double precision,
               edge_cost double precision, total_cost double precision,
               edge_same_quantity boolean, known_issues text[])
LANGUAGE sql STABLE AS $$
    SELECT d.path_seq, n.variable_id, e.max_lift, d.cost, d.agg_cost, e.same_quantity,
           n.known_issues
    FROM pgr_dijkstra(
        'SELECT edge_id AS id, source, target, cost FROM analysis.variable_graph',
        (SELECT node_id FROM analysis.variable_graph_nodes WHERE variable_id = p_from),
        (SELECT node_id FROM analysis.variable_graph_nodes WHERE variable_id = p_to),
        directed := false) d
    JOIN analysis.variable_graph_nodes n ON n.node_id = d.node
    LEFT JOIN analysis.variable_graph e ON e.edge_id = d.edge
    ORDER BY d.path_seq;
$$;
