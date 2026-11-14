-- 趨勢統計與資料探勘的結果（#85）。來源是結果檔（data/analysis/、data/extended/analysis/），
-- 由 `uv run python -m trend_detective.pg analysis` 載入；每次整批換新，run_id 指向 analysis.runs。
CREATE TABLE IF NOT EXISTS analysis.trends (
    series_id integer PRIMARY KEY REFERENCES meta.series (series_id),
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    status text NOT NULL,                 -- analyzed、insufficient
    reason_code text,
    first_month date,
    last_month date,
    n_valid integer,
    missing_fraction double precision,
    slope_per_decade double precision,
    ci_low_per_decade double precision,
    ci_high_per_decade double precision,
    ols_p double precision,               -- 自相關修正後的 t 檢定
    ols_q double precision,               -- BH-FDR 校正後
    ols_significant boolean,
    ols_significant_fdr boolean,
    lag1_autocorrelation double precision,
    n_effective double precision,
    mk_original_p double precision,
    mk_original_q double precision,
    mk_hamed_rao_p double precision,
    mk_hamed_rao_q double precision,
    mk_seasonal_p double precision,
    mk_seasonal_q double precision,
    sen_slope_per_decade double precision,
    fdr_scope text,
    auxiliary boolean NOT NULL DEFAULT false,
    known_issues text[] NOT NULL DEFAULT '{}',
    cleaning jsonb NOT NULL DEFAULT '{}', -- 該序列的清洗摘要（各旗標月數、最長缺口）
    result jsonb NOT NULL                 -- 結果檔裡這條序列的完整內容
);
CREATE INDEX IF NOT EXISTS trends_significant ON analysis.trends (ols_significant_fdr)
    WHERE ols_significant_fdr;

-- 顯著（FDR 校正後）的趨勢，附序列身分；預設不含輔助變數
CREATE OR REPLACE VIEW analysis.significant_trends AS
SELECT s.variable_id, s.location_id, s.aggregation, s.tier, t.slope_per_decade,
       t.ci_low_per_decade, t.ci_high_per_decade, t.ols_p, t.ols_q, t.known_issues,
       t.cleaning
FROM analysis.trends t
JOIN meta.series s USING (series_id)
WHERE t.ols_significant_fdr AND NOT t.auxiliary;

-- 一次探勘的參數、摘要，以及補值與不補值的比較（結果檔的 gap_filling_sensitivity）
CREATE TABLE IF NOT EXISTS analysis.mining_runs (
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    kind text NOT NULL CHECK (kind IN ('fpgrowth', 'decision_tree')),
    primary_variant text NOT NULL,        -- 主要結果是 filled 還是 unfilled
    parameters jsonb NOT NULL,
    summary jsonb NOT NULL,
    gap_filling_sensitivity jsonb NOT NULL,
    PRIMARY KEY (run_id, kind)
);

-- FP-growth 的規則（主要結果；結果檔列出的那些，最多 max_rules 條）
CREATE TABLE IF NOT EXISTS analysis.mining_rules (
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    table_kind text NOT NULL,             -- point、region
    timing text NOT NULL,                 -- same_month、lagged_one_month
    rule_set text NOT NULL,               -- rules、persistence_rules
    rank integer NOT NULL,                -- 依 lift 排序
    antecedents text[] NOT NULL,
    consequent text NOT NULL,
    support double precision,
    confidence double precision,
    lift double precision,
    p double precision,
    q double precision,
    PRIMARY KEY (run_id, table_kind, timing, rule_set, rank)
);
CREATE INDEX IF NOT EXISTS mining_rules_antecedents_gin ON analysis.mining_rules
    USING gin (antecedents);

-- 決策樹各折：補值與不補值兩個版本的準確率與三種基準；tree 只有主要結果有
CREATE TABLE IF NOT EXISTS analysis.tree_folds (
    run_id bigint NOT NULL REFERENCES analysis.runs (run_id),
    variant text NOT NULL,                -- filled、unfilled
    fold integer NOT NULL,
    test_first_month date,
    test_last_month date,
    n_train integer,
    n_test integer,
    test_accuracy double precision,
    train_majority_accuracy double precision,
    test_majority_accuracy double precision,
    persistence_accuracy double precision,
    tree jsonb,
    PRIMARY KEY (run_id, variant, fold)
);
