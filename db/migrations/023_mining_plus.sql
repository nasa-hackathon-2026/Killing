-- 探勘強化（#111）：模式與觀測差距的決策樹、描述統計，以及用相關係數建的變數關聯圖。
-- 可重跑（IF NOT EXISTS／OR REPLACE）。既有的 analysis.variable_graph（由關聯規則建的圖）不動。

-- 差距決策樹各折：variant 是 with_segment／without_segment／with_target_lag，
-- validation 是 walk_forward／leave_one_location_out
CREATE TABLE IF NOT EXISTS analysis.gap_tree_folds (
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    variant text NOT NULL,
    validation text NOT NULL,
    fold integer NOT NULL,
    held_out_station text,
    test_first_month date,
    test_last_month date,
    n_train integer NOT NULL,
    n_test integer NOT NULL,
    test_accuracy double precision NOT NULL,
    macro_f1 double precision NOT NULL,
    train_majority_accuracy double precision NOT NULL,
    persistence_accuracy double precision NOT NULL,
    calendar_month_accuracy double precision NOT NULL,
    above_all_baselines boolean NOT NULL,
    tree jsonb NOT NULL,
    PRIMARY KEY (run_id, variant, validation, fold)
);

-- 差值絕對值的分組平均（描述統計）：grouping 是 by_product、by_product_season、
-- by_product_segment、by_product_station
CREATE TABLE IF NOT EXISTS analysis.gap_stats (
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    grouping text NOT NULL,
    model_variable text NOT NULL,
    group_value text NOT NULL,
    n_months integer NOT NULL,
    mean_abs_difference double precision NOT NULL,
    median_abs_difference double precision NOT NULL,
    ci_low double precision,
    ci_high double precision,
    PRIMARY KEY (run_id, grouping, model_variable, group_value)
);

-- 相關係數建的變數關聯圖：節點與全部檢定過的配對（significant 的才是圖上的邊）。
-- lag = 1 是 source 領先 target 一個月。
CREATE TABLE IF NOT EXISTS analysis.correlation_nodes (
    table_kind text NOT NULL,            -- point、region
    node_id integer NOT NULL,
    variable_id text NOT NULL,
    component integer NOT NULL,          -- Python union-find 的結果（分量裡最小的 node_id）
    degree integer NOT NULL,
    PRIMARY KEY (table_kind, node_id)
);

CREATE TABLE IF NOT EXISTS analysis.correlation_edges (
    table_kind text NOT NULL,
    edge_id integer NOT NULL,
    source integer NOT NULL,
    target integer NOT NULL,
    source_variable text NOT NULL,
    target_variable text NOT NULL,
    lag integer NOT NULL,
    r double precision NOT NULL,
    p double precision NOT NULL,
    q double precision NOT NULL,
    n_eff double precision NOT NULL,
    significant boolean NOT NULL,
    PRIMARY KEY (table_kind, edge_id)
);

-- 一張表的連通分量與度數（只用顯著的邊；pgr_connectedComponents）。沒有邊的節點自成一個分量。
-- 度數是相鄰的不同變數個數。pgRouting 沒有建好時（測試用的空資料庫也會建）函式仍可建立。
CREATE EXTENSION IF NOT EXISTS pgrouting;

CREATE OR REPLACE FUNCTION analysis.correlation_components(p_table_kind text)
RETURNS TABLE (node_id integer, variable_id text, component integer, degree integer)
LANGUAGE sql STABLE AS $$
    SELECT n.node_id, n.variable_id,
           coalesce(c.component, n.node_id)::integer,
           (SELECT count(DISTINCT CASE WHEN e.source = n.node_id THEN e.target ELSE e.source END)
            FROM analysis.correlation_edges e
            WHERE e.table_kind = p_table_kind AND e.significant
              AND n.node_id IN (e.source, e.target))::integer
    FROM analysis.correlation_nodes n
    LEFT JOIN pgr_connectedComponents(format(
        'SELECT edge_id AS id, source, target, 1 AS cost FROM analysis.correlation_edges'
        ' WHERE significant AND table_kind = %L', p_table_kind)) c ON c.node = n.node_id
    WHERE n.table_kind = p_table_kind;
$$;
