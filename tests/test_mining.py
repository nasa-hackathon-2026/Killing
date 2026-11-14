"""資料探勘（#55）：用手造的小資料驗證交易表、規則指標與時間切分，不連網。"""

import json
from pathlib import Path

import numpy as np
import pytest

from trend_detective.mining import (
    MiningParams,
    association_rules,
    build_table,
    discretize,
    frequent_itemsets,
    lagged_transactions,
    main,
    majority_baseline,
    run_decision_tree,
    same_month_transactions,
    state_table,
    thresholds,
    time_split,
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
    rules = association_rules(itemsets, params)

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


def test_thresholds_filter_itemsets_and_rules():
    # 支持度門檻 0.5：A∩B（0.4）不是頻繁項目集，所以沒有規則
    high_support = MiningParams(min_support=0.5, min_confidence=0.1, min_lift=0.1)
    assert (
        association_rules(
            frequent_itemsets(hand_transactions(), high_support), high_support
        )
        == []
    )
    # 信賴度門檻 0.7：只剩 B → A（0.8）
    confident = MiningParams(min_support=0.1, min_confidence=0.7, min_lift=1.0)
    rules = association_rules(
        frequent_itemsets(hand_transactions(), confident), confident
    )
    assert [(r["antecedents"], r["consequent"]) for r in rules] == [(["B"], "A")]


def test_lagged_rules_only_go_from_previous_month_to_this_month():
    transactions = [frozenset({"prev:a=high", "a=high", "b=high"})] * 6 + [
        frozenset({"prev:a=low", "a=low", "b=low"})
    ] * 4
    params = MiningParams(min_support=0.1, min_confidence=0.5, min_lift=1.0)
    rules = association_rules(
        frequent_itemsets(transactions, params), params, lagged=True
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


def test_time_split_cuts_by_month_not_by_row():
    # 10 個月，其中一個月有 5 列：切點仍是第 9 個月（前 8 個月訓練）
    months = [*range(100, 110), 100, 100, 100, 100]

    assert time_split(months, 0.8) == 108


def test_time_split_needs_both_parts():
    with pytest.raises(ValueError):
        time_split([1, 1, 1], 0.8)


def test_majority_baseline_guesses_the_most_common_training_class():
    baseline = majority_baseline(
        ["high", "high", "low"], ["low", "low", "high", "normal"]
    )

    assert baseline["predicted_class"] == "high"
    assert baseline["tie"] is False
    assert baseline["train_accuracy"] == pytest.approx(2 / 3)
    assert baseline["test_accuracy"] == pytest.approx(1 / 4)
    assert baseline["best_constant_on_test"] == {
        "predicted_class": "low",
        "test_accuracy": pytest.approx(2 / 4),
    }


def tree_data(n: int = 200, shift_test: float = 0.0) -> dict:
    """目標 y 幾乎等於特徵 x；noise 與 y 無關。後 20% 的月份可以整段平移。"""
    rng = np.random.default_rng(0)
    series = {}
    for location in ("r1", "r2"):
        x = rng.normal(0, 1, n)
        y = x + rng.normal(0, 0.05, n)
        y[int(n * 0.8) :] += shift_test
        series[f"x__{location}__area_mean"] = ("2005-01-01", x.tolist())
        series[f"noise__{location}__area_mean"] = (
            "2005-01-01",
            rng.normal(0, 1, n).tolist(),
        )
        series[f"y__{location}__area_mean"] = ("2005-01-01", y.tolist())
    return anomalies_file(series)


TREE_PARAMS = MiningParams(exclude_variables=(), tree_target="y")


def test_tree_trains_on_earlier_months_and_tests_on_later_months():
    result = run_decision_tree(tree_data(), None, TREE_PARAMS)
    split = result["split"]

    # 200 個月 × 2 個地點：前 160 個月訓練（2005-01 至 2018-04），後 40 個月測試
    assert (split["train_first_month"], split["train_last_month"]) == (
        "2005-01-01",
        "2018-04-01",
    )
    assert (split["test_first_month"], split["test_last_month"]) == (
        "2018-05-01",
        "2021-08-01",
    )
    assert (split["n_train"], split["n_test"]) == (320, 80)
    assert result["features"] == ["noise", "x"]


def test_tree_finds_the_informative_feature_and_beats_the_baseline():
    result = run_decision_tree(tree_data(), None, TREE_PARAMS)

    assert result["tree"]["feature"] == "x"
    assert result["feature_importances"][0]["feature"] == "x"
    assert result["feature_importances"][0]["importance"] > 0.95
    assert result["accuracy"]["test"] > 0.85
    assert result["baseline_majority_class"]["test_accuracy"] < 0.5
    assert sum(result["tree"]["class_counts"].values()) == 320
    matrix = result["confusion_matrix_test"]
    assert sum(sum(row.values()) for row in matrix.values()) == 80


def test_target_thresholds_come_from_the_training_period_only():
    # 測試期間的 y 整段加 100：若門檻用到測試期間，訓練期間就不會剛好三等分
    result = run_decision_tree(tree_data(shift_test=100.0), None, TREE_PARAMS)

    counts = result["class_counts"]
    assert max(counts["train"].values()) - min(counts["train"].values()) <= 2
    assert counts["test"] == {"low": 0, "normal": 0, "high": 80}
    assert result["baseline_majority_class"]["best_constant_on_test"] == {
        "predicted_class": "high",
        "test_accuracy": 1.0,
    }


def test_rows_with_a_missing_feature_are_left_out_and_counted():
    data = tree_data()
    data["series"]["x__r1__area_mean"]["values"][3] = None
    del data["series"]["noise__r2__area_mean"]
    result = run_decision_tree(data, None, TREE_PARAMS)

    assert result["rows_by_location"]["r1"]["n_complete_rows"] == 199
    assert result["rows_by_location"]["r2"] == {
        "n_rows": 200,
        "n_complete_rows": 0,
        "missing_variables": ["noise"],
    }


def test_command_writes_exploratory_results_and_reruns_identically(tmp_path: Path):
    (tmp_path / "anomalies.json").write_text(json.dumps(tree_data()))
    args = [
        "--analysis-dir",
        str(tmp_path),
        "--exclude-variable",
        "",
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
        run = json.loads(second[name.replace(".json", ".run.json")])
        assert run["parameters"] == result["parameters"]
        assert run["exploratory"] is True
        assert "generated_at" in run
    rules = json.loads(second["fpgrowth.json"])
    assert rules["parameters"]["min_support"] == 0.1
    assert rules["tables"]["region"]["same_month"]["n_transactions"] == 400
    assert rules["tables"]["region"]["lagged_one_month"]["n_transactions"] == 398
    assert rules["tables"]["point"]["same_month"]["n_transactions"] == 0


def test_command_explains_when_anomalies_are_missing(tmp_path: Path, capsys):
    assert main(["--analysis-dir", str(tmp_path)]) == 1
    assert "trend_detective.trends" in capsys.readouterr().out
