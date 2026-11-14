"""資料探勘（#55、#59）：用手造的小資料驗證去趨勢、變數篩選、規則檢定與走動驗證，不連網。"""

import json
from pathlib import Path

import numpy as np
import pytest

from trend_detective.mining import (
    MiningParams,
    association_rules,
    build_table,
    detrend,
    detrend_table,
    discretize,
    fisher_p,
    fit_trend,
    fold_residuals,
    frequent_itemsets,
    lagged_transactions,
    main,
    majority_baselines,
    mine,
    pooled_correlation,
    run_decision_tree,
    run_fpgrowth,
    same_month_transactions,
    select_variables,
    significant_rules,
    state_table,
    thresholds,
    walk_forward_folds,
)

PARAMS = MiningParams(exclude_variables=())


def anomalies_file(series: dict[str, tuple[str, list[float | None]]]) -> dict:
    """`series` 的鍵是 `變數__地點__聚合方式`，值是 (起始月, 逐月距平)。"""
    out = {}
    for key, (first_month, values) in series.items():
        variable, location, aggregation = key.split("__")
        out[key] = {
            "variable_id": variable,
            "location_id": location,
            "aggregation": aggregation,
            "unit": "1",
            "first_month": first_month,
            "values": values,
        }
    return {
        "input": {"snapshot_generated_at": "2026-11-14T00:00:00Z"},
        "parameters": {"min_coverage": 0.25},
        "series": out,
    }


def test_tertiles_split_a_series_into_three_equal_groups():
    # 1..9 的三分位點是 3.67 與 6.33
    values = np.arange(1.0, 10.0)
    low, high = thresholds(values, PARAMS)

    assert (low, high) == (pytest.approx(11 / 3), pytest.approx(19 / 3))
    assert discretize(values, low, high) == ["low"] * 3 + ["normal"] * 3 + ["high"] * 3


def test_missing_value_has_no_state():
    assert discretize(np.array([np.nan, 5.0]), 1, 2) == [None, "high"]


def test_table_uses_the_common_period_and_one_kind_of_series():
    data = anomalies_file(
        {
            # a 從 2020-01 起 4 個月，b 從 2020-02 起 4 個月：共同期間 2020-02 至 2020-04
            "a__p1__point": ("2020-01-01", [9.0, 1.0, 2.0, 3.0]),
            "b__p1__point": ("2020-02-01", [4.0, None, 6.0, 9.0]),
            "a__r1__area_mean": ("2020-01-01", [1.0, 1.0, 1.0, 1.0]),
            "a__s1__station": ("2020-01-01", [1.0, 1.0, 1.0, 1.0]),
        }
    )
    table = build_table(data, None, "point", PARAMS)

    assert table.locations == ["p1"]
    assert table.variables == ["a", "b"]
    assert table.months == ["2020-02-01", "2020-03-01", "2020-04-01"]
    assert table.values["p1"]["a"].tolist() == [1.0, 2.0, 3.0]
    assert np.isnan(table.values["p1"]["b"][1])
    assert table.values["p1"]["b"][[0, 2]].tolist() == [4.0, 6.0]


def test_insufficient_and_excluded_series_stay_out_of_the_table():
    data = anomalies_file(
        {
            "a__p1__point": ("2020-01-01", [1.0, 2.0]),
            "b__p1__point": ("2020-01-01", [1.0, 2.0]),
            "c__p1__point": ("2020-01-01", [1.0, 2.0]),
        }
    )
    trends = {"series": {"b__p1__point": {"status": "insufficient"}}}
    table = build_table(data, trends, "point", MiningParams(exclude_variables=("c",)))

    assert table.variables == ["a"]
    assert table.dropped_series == [
        {"variable_id": "b", "location_id": "p1", "reason": "insufficient"}
    ]


def test_taiwan_is_left_out_by_default_because_it_overlaps_the_other_regions():
    data = anomalies_file(
        {
            "a__taiwan__area_mean": ("2020-01-01", [1.0, 2.0]),
            "a__north__area_mean": ("2020-01-01", [1.0, 2.0]),
        }
    )

    assert build_table(data, None, "region", MiningParams()).locations == ["north"]
    assert build_table(
        data, None, "region", MiningParams(exclude_locations=())
    ).locations == ["north", "taiwan"]


def trending_series(n: int = 240) -> tuple[np.ndarray, np.ndarray]:
    """已知斜率每年 0.5 的直線加上標準差 1 的雜訊；20 年累積 10，遠大於雜訊。"""
    rng = np.random.default_rng(1)
    index = 2005 * 12 + np.arange(n)
    return index, 3.0 + 0.5 * np.arange(n) / 12 + rng.normal(0, 1, n)


def test_fit_trend_recovers_a_known_line_exactly():
    index = 2005 * 12 + np.arange(36)
    slope, intercept, origin = fit_trend(index, 2.0 - 1.2 * np.arange(36) / 12)

    assert slope == pytest.approx(-1.2)
    assert intercept == pytest.approx(2.0)
    assert origin == 2005 * 12


def test_without_detrending_the_last_third_of_a_trending_series_is_all_high():
    _, values = trending_series()
    states = discretize(values, *thresholds(values, PARAMS))

    # 雜訊讓交界處少數月份落到 normal，但後三分之一沒有 low、前三分之一沒有 high
    assert states[160:].count("high") >= 65
    assert states[160:].count("low") == 0
    assert states[:80].count("low") >= 65
    assert states[:80].count("high") == 0


def test_detrending_brings_each_period_back_to_about_one_third_per_state():
    index, values = trending_series()
    residual = detrend(index, values)
    states = discretize(residual, *thresholds(residual, PARAMS))

    for start in (0, 80, 160):
        part = states[start : start + 80]
        for state in ("low", "normal", "high"):
            # 80 個月的三分之一是 26.7；獨立雜訊下落在 15 至 40 之外的機率極低
            assert 15 <= part.count(state) <= 40
    assert fit_trend(index, residual)[0] == pytest.approx(0, abs=1e-9)


def test_detrending_keeps_missing_months_missing():
    index, values = trending_series(60)
    values[[5, 30]] = np.nan
    residual = detrend(index, values)

    assert np.isnan(residual[[5, 30]]).all()
    assert not np.isnan(np.delete(residual, [5, 30])).any()


def correlated_data() -> dict:
    """twin 幾乎等於 base（雜訊標準差 0.05 對 1），other 是獨立的；兩個地點。"""
    rng = np.random.default_rng(2)
    series = {}
    for location in ("p1", "p2"):
        base = rng.normal(0, 1, 120)
        series[f"base__{location}__point"] = ("2010-01-01", base.tolist())
        series[f"twin__{location}__point"] = (
            "2010-01-01",
            (-base + rng.normal(0, 0.05, 120)).tolist(),
        )
        series[f"other__{location}__point"] = (
            "2010-01-01",
            rng.normal(0, 1, 120).tolist(),
        )
    return anomalies_file(series)


def test_pooled_correlation_uses_months_where_both_variables_have_values():
    data = anomalies_file(
        {
            # 兩個地點合併後的配對：(1,2) (2,4) (3,6) (10,20)，完全線性
            "a__p1__point": ("2020-01-01", [1.0, 2.0, 3.0, None]),
            "b__p1__point": ("2020-01-01", [2.0, 4.0, 6.0, 9.0]),
            "a__p2__point": ("2020-01-01", [10.0, None, 5.0, 5.0]),
            "b__p2__point": ("2020-01-01", [20.0, 1.0, None, None]),
        }
    )
    table = build_table(data, None, "point", PARAMS)

    assert pooled_correlation(table, "a", "b") == (pytest.approx(1.0), 4)


def test_near_duplicate_variable_is_dropped_in_priority_order():
    table = detrend_table(build_table(correlated_data(), None, "point", PARAMS))

    kept, excluded = select_variables(table, ("base", "twin", "other"), PARAMS)
    assert kept == ["base", "other"]
    assert [(e["variable_id"], e["correlated_with"]) for e in excluded] == [
        ("twin", "base")
    ]
    # 負相關也算：看的是絕對值
    assert excluded[0]["correlation"] < -0.99
    assert excluded[0]["n_pairs"] == 240

    # 優先順序反過來，被排除的就換成 base
    kept, excluded = select_variables(table, ("twin", "other", "base"), PARAMS)
    assert kept == ["twin", "other"]
    assert excluded[0]["variable_id"] == "base"


def test_variables_outside_the_priority_list_come_last_by_name():
    table = detrend_table(build_table(correlated_data(), None, "point", PARAMS))

    kept, _ = select_variables(table, ("twin",), PARAMS)
    assert kept == ["twin", "other"]


def test_correlation_threshold_is_adjustable():
    table = detrend_table(build_table(correlated_data(), None, "point", PARAMS))

    kept, excluded = select_variables(
        table, ("base", "twin", "other"), MiningParams(max_abs_correlation=1.0)
    )
    assert kept == ["base", "twin", "other"]
    assert excluded == []


def test_rule_tables_record_excluded_variables_and_leave_them_out():
    result = run_fpgrowth(correlated_data(), None, PARAMS, ("base", "twin", "other"))
    table = result["tables"]["point"]

    assert table["variables"] == ["base", "other"]
    assert [e["variable_id"] for e in table["excluded_variables"]] == ["twin"]


def test_each_location_month_is_one_transaction_without_missing_items():
    states = {
        "p1": {"a": ["low", "high"], "b": ["normal", None]},
        "p2": {"a": ["high", "low"]},
    }

    assert same_month_transactions(states, 2) == [
        frozenset({"a=low", "b=normal"}),
        frozenset({"a=high"}),
        frozenset({"a=high"}),
        frozenset({"a=low"}),
    ]


def test_states_come_from_each_series_own_tertiles():
    # 兩條序列的數值範圍差一百倍，各自的最小值都是 low、最大值都是 high
    data = anomalies_file(
        {
            "a__p1__point": ("2020-01-01", [1.0, 2.0, 3.0]),
            "a__p2__point": ("2020-01-01", [300.0, 100.0, 200.0]),
        }
    )
    states = state_table(build_table(data, None, "point", PARAMS), PARAMS)

    assert states["p1"]["a"] == ["low", "normal", "high"]
    assert states["p2"]["a"] == ["high", "low", "normal"]


def test_lagged_transaction_pairs_previous_month_with_this_month_per_location():
    states = {
        "p1": {"a": ["low", "high", "normal"]},
        "p2": {"a": ["high", None, "low"]},
    }

    # 每個地點少第一個月；不會把 p1 的最後一個月接到 p2 的第一個月
    assert lagged_transactions(states, 3) == [
        frozenset({"prev:a=low", "a=high"}),
        frozenset({"prev:a=high", "a=normal"}),
        frozenset({"prev:a=high"}),
        frozenset({"a=low"}),
    ]


def hand_transactions() -> list[frozenset[str]]:
    # 10 筆：A 出現 6 次、B 出現 5 次、A 與 B 同時 4 次
    return (
        [frozenset({"A", "B"})] * 4
        + [frozenset({"A"})] * 2
        + [frozenset({"B"})]
        + [frozenset({"C"})] * 3
    )


def test_support_confidence_and_lift_match_hand_calculation():
    params = MiningParams(min_support=0.1, min_confidence=0.6, min_lift=1.0)
    itemsets = frequent_itemsets(hand_transactions(), params)
    rules = association_rules(itemsets, params, 10)

    assert itemsets[frozenset({"A"})] == pytest.approx(0.6)
    assert itemsets[frozenset({"A", "B"})] == pytest.approx(0.4)
    by_rule = {(tuple(r["antecedents"]), r["consequent"]): r for r in rules}
    # A → B：信賴度 4/6，lift (4/6) ÷ 0.5；B → A：信賴度 4/5，lift 0.8 ÷ 0.6
    a_to_b = by_rule[(("A",), "B")]
    assert a_to_b["support"] == pytest.approx(0.4)
    assert a_to_b["confidence"] == pytest.approx(4 / 6)
    assert a_to_b["lift"] == pytest.approx(4 / 3)
    assert by_rule[(("B",), "A")]["confidence"] == pytest.approx(0.8)
    assert by_rule[(("B",), "A")]["lift"] == pytest.approx(4 / 3)
    # lift 相同時信賴度高的排前面
    assert [r["consequent"] for r in rules] == ["A", "B"]


def test_fisher_p_matches_the_hypergeometric_tail_by_hand():
    # 10 筆交易，A 6 筆、B 5 筆、同時 4 筆。固定邊際下「同時 ≥ 4」的機率：
    # [C(6,4)·C(4,1) + C(6,5)·C(4,0)] ÷ C(10,5) = (60 + 6) ÷ 252
    assert fisher_p(4, 6, 5, 10) == pytest.approx(66 / 252)
    # 規則的方向不影響 p（列聯表轉置）
    assert fisher_p(4, 5, 6, 10) == pytest.approx(66 / 252)

    params = MiningParams(min_support=0.1, min_confidence=0.6, min_lift=1.0)
    rules = association_rules(
        frequent_itemsets(hand_transactions(), params), params, 10
    )
    assert [rule["p"] for rule in rules] == [pytest.approx(66 / 252)] * 2


def test_fdr_keeps_only_rules_below_alpha_and_reports_q():
    # BH：p 由小到大 0.005、0.01、0.03、0.04，乘 4/名次得 0.02、0.02、0.04、0.04
    candidates = [{"id": i, "p": p} for i, p in enumerate([0.01, 0.04, 0.03, 0.005])]

    kept = significant_rules(candidates, 0.05)
    assert [(r["id"], r["q"]) for r in kept] == [
        (0, pytest.approx(0.02)),
        (1, pytest.approx(0.04)),
        (2, pytest.approx(0.04)),
        (3, pytest.approx(0.02)),
    ]
    assert [r["id"] for r in significant_rules(candidates, 0.03)] == [0, 3]
    assert significant_rules([], 0.05) == []


def test_fdr_runs_over_all_candidates_of_one_setting():
    # 單獨一條 p = 0.04 會過；和另外三條 p = 0.9 一起校正後 q = 0.16，不過
    candidates = [{"p": 0.04}, {"p": 0.9}, {"p": 0.9}, {"p": 0.9}]

    assert significant_rules(candidates[:1], 0.05) == [{"p": 0.04, "q": 0.04}]
    assert significant_rules(candidates, 0.05) == []


def test_kept_rules_never_have_the_same_variable_on_both_sides():
    # a 與 b 每個月同狀態，而且各自持續：延遲版同時有跨變數與同變數的候選規則
    blocks = (["high"] * 6 + ["low"] * 6) * 5
    states: dict[str, dict[str, list[str | None]]] = {
        "p1": {"a": list(blocks), "b": list(blocks)}
    }
    params = MiningParams(min_support=0.05, min_confidence=0.6, min_lift=1.2)
    result = mine(lagged_transactions(states, 60), params, lagged=True)

    assert result["n_rules"] > 0
    assert result["n_persistence_rules"] > 0
    for rule in result["rules"]:
        left = {
            item.removeprefix("prev:").split("=")[0] for item in rule["antecedents"]
        }
        assert rule["consequent"].split("=")[0] not in left
        assert rule["q"] < 0.05
    for rule in result["persistence_rules"]:
        left = {
            item.removeprefix("prev:").split("=")[0] for item in rule["antecedents"]
        }
        assert rule["consequent"].split("=")[0] in left


def test_rules_that_fail_the_significance_test_are_dropped_but_counted():
    # 過得了門檻但樣本太少：p = 66/252，不顯著
    params = MiningParams(min_support=0.1, min_confidence=0.6, min_lift=1.0)
    result = mine(hand_transactions(), params)

    assert result["n_candidate_rules"] == 2
    assert result["n_rules"] == 0
    assert result["rules"] == []


def test_thresholds_filter_itemsets_and_rules():
    # 支持度門檻 0.5：A∩B（0.4）不是頻繁項目集，所以沒有規則
    high_support = MiningParams(min_support=0.5, min_confidence=0.1, min_lift=0.1)
    assert (
        association_rules(
            frequent_itemsets(hand_transactions(), high_support), high_support, 10
        )
        == []
    )
    # 信賴度門檻 0.7：只剩 B → A（0.8）
    confident = MiningParams(min_support=0.1, min_confidence=0.7, min_lift=1.0)
    rules = association_rules(
        frequent_itemsets(hand_transactions(), confident), confident, 10
    )
    assert [(r["antecedents"], r["consequent"]) for r in rules] == [(["B"], "A")]


def test_lagged_rules_only_go_from_previous_month_to_this_month():
    transactions = [frozenset({"prev:a=high", "a=high", "b=high"})] * 6 + [
        frozenset({"prev:a=low", "a=low", "b=low"})
    ] * 4
    params = MiningParams(min_support=0.1, min_confidence=0.5, min_lift=1.0)
    rules = association_rules(
        frequent_itemsets(transactions, params), params, 10, lagged=True
    )

    assert rules
    for rule in rules:
        assert all(item.startswith("prev:") for item in rule["antecedents"])
        assert not rule["consequent"].startswith("prev:")
    same = {
        (tuple(r["antecedents"]), r["consequent"]): r["same_variable"] for r in rules
    }
    assert same[(("prev:a=high",), "a=high")] is True
    assert same[(("prev:a=high",), "b=high")] is False


def test_walk_forward_folds_do_not_overlap_and_train_only_on_earlier_months():
    # 10 個月、最少訓練 4 個月、3 折：測試折是 [4,5]、[6,7]、[8,9]
    assert walk_forward_folds(list(range(100, 110)), 3, 4) == [
        ([100, 101, 102, 103], [104, 105]),
        ([100, 101, 102, 103, 104, 105], [106, 107]),
        ([100, 101, 102, 103, 104, 105, 106, 107], [108, 109]),
    ]


def test_walk_forward_folds_cut_by_month_not_by_row_and_share_the_remainder():
    # 同一個月有很多列也只算一個月；剩 7 個月切 3 折是 3、2、2
    months = [*range(11), 0, 0, 0, 0]
    folds = walk_forward_folds(months, 3, 4)

    assert [test for _, test in folds] == [[4, 5, 6], [7, 8], [9, 10]]
    for train, test in folds:
        assert max(train) < min(test)


def test_walk_forward_needs_enough_months():
    with pytest.raises(ValueError):
        walk_forward_folds(list(range(6)), 3, 4)


def test_two_baselines_guess_the_training_and_the_test_majority():
    baselines = majority_baselines(
        ["high", "high", "low"], ["low", "low", "high", "normal"]
    )

    assert baselines == {
        "train_majority": {
            "predicted_class": "high",
            "tie": False,
            "test_accuracy": pytest.approx(1 / 4),
        },
        "test_majority": {
            "predicted_class": "low",
            "test_accuracy": pytest.approx(2 / 4),
        },
    }


def test_fold_residuals_estimate_means_and_trend_from_training_months_only():
    # 訓練期（前 48 個月）只有月份效應（1 月 0、2 月 1 …）；測試期另外加 50
    values = np.tile(np.arange(12.0), 5)
    values[48:] += 50

    residual = fold_residuals(values, 2010 * 12, 48)
    assert residual[:48] == pytest.approx(0, abs=1e-9)
    assert residual[48:] == pytest.approx(50)

    # 測試期的數值再怎麼改，訓練期的殘差都不變
    changed = values.copy()
    changed[48:] = -999.0
    assert fold_residuals(changed, 2010 * 12, 48)[:48] == pytest.approx(
        residual[:48], abs=1e-12
    )


def tree_data(n: int = 200, slope_per_month: float = 0.0, seed: int = 0) -> dict:
    """目標 y 幾乎等於同月份的 x；noise 與 y 無關。y 可以另外加一條直線趨勢。"""
    rng = np.random.default_rng(seed)
    series = {}
    for location in ("r1", "r2"):
        x = rng.normal(0, 1, n)
        y = x + rng.normal(0, 0.05, n) + slope_per_month * np.arange(n)
        series[f"x__{location}__area_mean"] = ("2005-01-01", x.tolist())
        series[f"noise__{location}__area_mean"] = (
            "2005-01-01",
            rng.normal(0, 1, n).tolist(),
        )
        series[f"y__{location}__area_mean"] = ("2005-01-01", y.tolist())
    return anomalies_file(series)


# y 與 x 幾乎相同，所以這組測試把相關係數門檻關掉（1 表示不排除）
TREE_PARAMS = MiningParams(tree_target="y", max_abs_correlation=1.0)


def test_tree_is_validated_on_three_later_blocks_of_months():
    result = run_decision_tree(tree_data(), None, TREE_PARAMS)

    # 200 個月，第一個月沒有前一個月：可用 2005-02 起 199 個月。前 120 個月只訓練，
    # 剩 79 個月切成 27、26、26
    assert [
        (f["train_first_month"], f["train_last_month"]) for f in result["folds"]
    ] == [
        ("2005-02-01", "2015-01-01"),
        ("2005-02-01", "2017-04-01"),
        ("2005-02-01", "2019-06-01"),
    ]
    assert [(f["test_first_month"], f["test_last_month"]) for f in result["folds"]] == [
        ("2015-02-01", "2017-04-01"),
        ("2017-05-01", "2019-06-01"),
        ("2019-07-01", "2021-08-01"),
    ]
    assert [(f["n_train"], f["n_test"]) for f in result["folds"]] == [
        (240, 54),
        (294, 52),
        (346, 52),
    ]
    assert result["validation"]["n_folds"] == 3


def test_tree_features_include_the_previous_month_of_every_variable():
    result = run_decision_tree(tree_data(), None, TREE_PARAMS)
    assert result["features"] == ["noise", "x", "prev:noise", "prev:x", "prev:y"]

    without = MiningParams(
        tree_target="y", max_abs_correlation=1.0, tree_include_target_lag=False
    )
    assert run_decision_tree(tree_data(), None, without)["features"] == [
        "noise",
        "x",
        "prev:noise",
        "prev:x",
    ]


def test_tree_finds_the_informative_feature_and_beats_both_baselines():
    result = run_decision_tree(tree_data(), None, TREE_PARAMS)

    for fold in result["folds"]:
        assert fold["tree"]["feature"] == "x"
        assert fold["feature_importances"][0]["feature"] == "x"
        assert fold["accuracy"]["test"] > 0.85
        assert fold["baselines"]["train_majority"]["test_accuracy"] < 0.6
        assert fold["baselines"]["test_majority"]["test_accuracy"] < 0.6
        assert fold["above_train_majority"] and fold["above_test_majority"]
        assert sum(fold["tree"]["class_counts"].values()) == fold["n_train"]
        matrix = fold["confusion_matrix_test"]
        assert sum(sum(row.values()) for row in matrix.values()) == fold["n_test"]
    summary = result["summary"]
    assert summary["n_folds_above_both"] == 3
    assert summary["above_both_in_every_fold"] is True
    assert "3 of 3 folds" in summary["text_en"]
    assert "does not beat" not in summary["text_en"]


def test_tree_says_so_when_it_does_not_beat_the_baselines():
    # 目標與所有特徵都無關（各自獨立的雜訊）：樹沒有東西可學
    rng = np.random.default_rng(5)
    series = {
        f"{variable}__r1__area_mean": ("2005-01-01", rng.normal(0, 1, 200).tolist())
        for variable in ("x", "noise", "y")
    }
    params = MiningParams(tree_target="y", tree_include_target_lag=False)
    result = run_decision_tree(anomalies_file(series), None, params)
    summary = result["summary"]

    assert summary["n_folds_above_both"] < 3
    assert summary["above_both_in_every_fold"] is False
    assert "does not beat always guessing one class" in summary["text_en"]
    for fold in result["folds"]:
        # 測試期最多的類別至少佔三分之一，而且不會低於訓練期最多的類別在測試期的比例
        best = fold["baselines"]["test_majority"]["test_accuracy"]
        assert best >= 1 / 3
        assert best >= fold["baselines"]["train_majority"]["test_accuracy"]


def test_trending_target_is_detrended_so_training_classes_stay_balanced():
    # y 每個月多 0.1（200 個月累積 20，遠大於逐月變動 1）
    result = run_decision_tree(tree_data(slope_per_month=0.1), None, TREE_PARAMS)

    for fold in result["folds"]:
        counts = fold["class_counts"]["train"]
        assert max(counts.values()) - min(counts.values()) <= 4
        # 沒去趨勢的話測試期會全部是 high
        assert fold["class_counts"]["test"]["high"] < 0.6 * fold["n_test"]
        assert fold["accuracy"]["test"] > 0.8


def test_changing_test_months_does_not_change_what_training_estimated():
    base = tree_data(slope_per_month=0.02)
    changed = json.loads(json.dumps(base))
    # 最後一折的測試期是位置 174 起（2019-07）；把那之後所有序列都加 100
    for series in changed["series"].values():
        series["values"] = [
            value + 100 if i >= 174 else value
            for i, value in enumerate(series["values"])
        ]
    first = run_decision_tree(base, None, TREE_PARAMS)
    second = run_decision_tree(changed, None, TREE_PARAMS)

    # 前兩折完全沒用到被改的月份
    assert second["folds"][:2] == first["folds"][:2]
    # 最後一折：訓練期估出來的門檻、樹與訓練準確率都不變，只有測試結果不同
    for name in ("target_thresholds", "tree", "tree_text", "feature_importances"):
        assert second["folds"][2][name] == first["folds"][2][name]
    assert (
        second["folds"][2]["accuracy"]["train"]
        == first["folds"][2]["accuracy"]["train"]
    )
    assert second["folds"][2]["class_counts"]["test"] == {
        "low": 0,
        "normal": 0,
        "high": 52,
    }


def test_rows_with_a_missing_feature_are_left_out_and_counted():
    data = tree_data()
    data["series"]["x__r1__area_mean"]["values"][3] = None
    del data["series"]["noise__r2__area_mean"]
    result = run_decision_tree(data, None, TREE_PARAMS)

    # 位置 3 缺 x：那個月的列與下一個月（要用它當前一個月）的列都不能用
    assert result["rows_by_location"]["r1"] == {
        "n_rows": 199,
        "n_complete_rows": 197,
        "missing_variables": [],
    }
    assert result["rows_by_location"]["r2"] == {
        "n_rows": 199,
        "n_complete_rows": 0,
        "missing_variables": ["noise"],
    }


def test_target_removed_as_a_near_duplicate_is_an_error_that_says_why():
    # 預設門檻下 y 與 x 幾乎相同；x 優先，所以 y 被排除
    with pytest.raises(ValueError, match="x"):
        run_decision_tree(tree_data(), None, MiningParams(tree_target="y"), ("x", "y"))


def test_command_writes_exploratory_results_and_reruns_identically(tmp_path: Path):
    (tmp_path / "anomalies.json").write_text(json.dumps(tree_data()))
    (tmp_path / "catalog.json").write_text(
        json.dumps(
            {
                "variables": [
                    {"id": "y", "name_en": "Target (Y)"},
                    {"id": "x", "name_en": "Driver (X)"},
                ]
            }
        )
    )
    args = [
        "--analysis-dir",
        str(tmp_path),
        "--snapshot-dir",
        str(tmp_path),
        "--max-abs-correlation",
        "1",
        "--tree-target",
        "y",
    ]

    assert main(args) == 0
    first = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert main(args) == 0
    second = {p.name: p.read_bytes() for p in tmp_path.iterdir()}

    for name in ("fpgrowth.json", "decision_tree.json"):
        assert first[name] == second[name]
        result = json.loads(second[name])
        assert result["exploratory"] is True
        assert "generated_at" not in result
        assert result["input"]["snapshot_generated_at"] == "2026-11-14T00:00:00Z"
        # 目錄檔的順序在前，不在目錄裡的變數排最後並以 id 當名稱
        assert result["variable_priority"] == ["y", "x", "noise"]
        assert result["variable_names"] == {
            "y": "Target (Y)",
            "x": "Driver (X)",
            "noise": "noise",
        }
        assert result["parameters"]["max_abs_correlation"] == 1.0
        assert result["parameters"]["exclude_locations"] == ["taiwan"]
        run = json.loads(second[name.replace(".json", ".run.json")])
        assert run["parameters"] == result["parameters"]
        assert run["exploratory"] is True
        assert "generated_at" in run
    rules = json.loads(second["fpgrowth.json"])
    assert rules["parameters"]["min_support"] == 0.05
    assert rules["parameters"]["min_lift"] == 1.5
    assert rules["parameters"]["rule_alpha"] == 0.05
    assert "not independent" in rules["significance_note"]
    assert rules["tables"]["region"]["same_month"]["n_transactions"] == 400
    assert rules["tables"]["region"]["lagged_one_month"]["n_transactions"] == 398
    assert rules["tables"]["region"]["excluded_variables"] == []
    assert rules["tables"]["point"]["same_month"]["n_transactions"] == 0
    tree = json.loads(second["decision_tree.json"])
    assert tree["parameters"]["tree_n_folds"] == 3
    assert tree["parameters"]["tree_min_train_months"] == 120
    assert len(tree["folds"]) == 3


def test_command_default_drops_the_near_duplicate_and_records_it(tmp_path: Path):
    (tmp_path / "anomalies.json").write_text(json.dumps(tree_data()))
    args = ["--analysis-dir", str(tmp_path), "--snapshot-dir", str(tmp_path)]

    # 沒有目錄檔時依名稱排序：noise、x、y，所以 y 因為和 x 相關而被排除
    assert main([*args, "--tree-target", "x"]) == 0
    rules = json.loads((tmp_path / "fpgrowth.json").read_text())
    excluded = rules["tables"]["region"]["excluded_variables"]
    assert [(e["variable_id"], e["correlated_with"]) for e in excluded] == [("y", "x")]
    assert excluded[0]["correlation"] > 0.99
    assert rules["tables"]["region"]["variables"] == ["noise", "x"]


def test_command_explains_when_anomalies_are_missing(tmp_path: Path, capsys):
    assert main(["--analysis-dir", str(tmp_path)]) == 1
    assert "trend_detective.trends" in capsys.readouterr().out
