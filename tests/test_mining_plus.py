"""探勘強化（#111）：切分、分級、基準、FDR、有效樣本數與洩漏檢查都是純函式，不連資料庫。"""

import math

import numpy as np
import pytest

from trend_detective import gap_tree, mining_stats, similar_series, variable_graph
from trend_detective.trends import benjamini_hochberg

PARAMS = gap_tree.GapParams()


def ar1(n: int, phi: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    for i in range(1, n):
        out[i] = phi * out[i - 1] + rng.normal()
    return out


# ---- mining_stats ----


def test_detrend_removes_a_line_and_keeps_missing_months() -> None:
    index = np.arange(24, dtype=np.int64)
    values = 0.5 * index + 3.0
    values[5] = np.nan
    out = mining_stats.detrend(index, values)
    assert math.isnan(out[5])
    assert np.nanmax(np.abs(out)) < 1e-9


def test_align_pairs_source_one_month_earlier_when_lag_is_one() -> None:
    index = np.arange(10, 15, dtype=np.int64)
    x = np.array([1.0, 2.0, np.nan, 4.0, 5.0])
    y = np.array([10.0, 20.0, 30.0, 40.0, 50.0])
    months, left, right = mining_stats.align(index, x, index, y, lag=1)
    # x 在月份 t−1、y 在月份 t；x 的 NaN（月份 12）使月份 13 沒有配對
    assert months.tolist() == [11, 12, 14]
    assert left.tolist() == [1.0, 2.0, 4.0]
    assert right.tolist() == [20.0, 30.0, 50.0]


def test_effective_n_equals_n_for_white_noise_and_shrinks_with_autocorrelation() -> (
    None
):
    index = np.arange(600, dtype=np.int64)
    rng = np.random.default_rng(0)
    white = mining_stats.effective_n(index, rng.normal(size=600), rng.normal(size=600))
    red = mining_stats.effective_n(index, ar1(600, 0.8, 1), ar1(600, 0.8, 2))
    assert white > 550
    # phi = 0.8 兩條：理論值 n × (1 − 0.64) ÷ (1 + 0.64) ≈ 132
    assert 80 < red < 200


def test_effective_n_is_clamped_between_three_and_n() -> None:
    index = np.arange(50, dtype=np.int64)
    ramp = np.arange(50, dtype=float)
    assert mining_stats.effective_n(index, ramp, ramp) >= 3.0
    alternating = np.array([1.0, -1.0] * 25)
    assert mining_stats.effective_n(index, alternating, -alternating) <= 50.0


def test_correlation_p_grows_when_effective_n_shrinks() -> None:
    assert mining_stats.correlation_p(0.3, 200) < 0.001
    assert mining_stats.correlation_p(0.3, 20) > 0.1
    assert mining_stats.correlation_p(1.0, 20) == 0.0
    assert mining_stats.correlation_p(0.3, 2) == 1.0


def test_autocorrelated_unrelated_series_are_rarely_significant() -> None:
    index = np.arange(240, dtype=np.int64)
    hits = 0
    for seed in range(200):
        test = mining_stats.correlation_test(
            index, ar1(240, 0.7, seed), ar1(240, 0.7, 10_000 + seed)
        )
        hits += test["p"] < 0.05
    # 不修正時約 20% 以上；修正後接近名目的 5%
    assert hits / 200 < 0.1


def test_components_label_each_node_with_the_smallest_member() -> None:
    found = mining_stats.components([1, 2, 3, 4, 5], [(2, 3), (5, 4)])
    assert found == {1: 1, 2: 2, 3: 2, 4: 4, 5: 4}


def test_block_bootstrap_is_reproducible_and_wider_than_zero() -> None:
    values = np.arange(48, dtype=float)
    years = np.repeat(np.arange(4), 12)
    first = mining_stats.block_bootstrap_mean(values, years, 500, 0, 0.05)
    assert first == mining_stats.block_bootstrap_mean(values, years, 500, 0, 0.05)
    assert first[0] < values.mean() < first[1]
    assert math.isnan(
        mining_stats.block_bootstrap_mean(values, np.zeros(48), 500, 0, 0.05)[0]
    )


def test_benjamini_hochberg_is_monotone_and_not_below_p() -> None:
    p = [0.001, 0.02, 0.03, 0.5]
    q = benjamini_hochberg(p)
    assert all(b >= a for a, b in zip(p, q, strict=True))
    assert q == sorted(q)


# ---- gap_tree：分級、切分、基準 ----


def test_season_and_segment() -> None:
    january_2001 = 2001 * 12
    assert [gap_tree.season_of(january_2001 + k) for k in (0, 1, 2, 5, 8, 11)] == [
        "DJF",
        "DJF",
        "MAM",
        "JJA",
        "SON",
        "DJF",
    ]
    breaks = [100, 200]
    assert [gap_tree.segment_of(m, breaks) for m in (99, 100, 199, 200)] == [1, 2, 2, 3]


def test_classify_uses_given_thresholds_and_marks_missing() -> None:
    values = np.array([0.1, 0.2, 0.3, 0.9, np.nan])
    assert gap_tree.classify(values, 0.2, 0.5).tolist() == [0, 0, 1, 2, -1]


def test_recenter_and_states_ignore_the_test_period() -> None:
    index = np.arange(240, dtype=np.int64)
    rng = np.random.default_rng(3)
    values = rng.normal(size=240)
    train = index < 180
    changed = values.copy()
    changed[180:] += 50.0
    # 改掉測試期的值，訓練期的置中與分級不變
    assert np.array_equal(
        gap_tree.recenter(index, values, train)[:180],
        gap_tree.recenter(index, changed, train)[:180],
    )
    assert np.array_equal(
        gap_tree.fold_states(index, values, train, PARAMS)[:180],
        gap_tree.fold_states(index, changed, train, PARAMS)[:180],
    )
    # 測試期全部被判成 high：門檻沒有因為測試期而移動
    assert set(gap_tree.fold_states(index, changed, train, PARAMS)[180:]) == {1.0}


def test_fold_states_split_training_months_into_thirds() -> None:
    index = np.arange(120, dtype=np.int64)
    values = np.random.default_rng(5).normal(size=120)
    states = gap_tree.fold_states(index, values, np.ones(120, dtype=bool), PARAMS)
    counts = [int((states == k).sum()) for k in (-1.0, 0.0, 1.0)]
    assert counts == [40, 40, 40]


def test_majority_and_calendar_month_baseline() -> None:
    assert gap_tree.majority(np.array([2, 2, 1, 1, 0])) == 1  # 同數取編號小的
    train_months = np.array([1, 1, 1, 2, 2, 2])
    train_labels = np.array([0, 0, 2, 2, 2, 1])
    guess = gap_tree.calendar_month_prediction(
        train_months, train_labels, np.array([1, 2, 7])
    )
    # 7 月不在訓練列：猜整體最多的類別（2 有 3 筆）
    assert guess.tolist() == [0, 2, 2]


def test_accuracy_and_macro_f1() -> None:
    actual = np.array([0, 0, 1, 1, 2, 2])
    assert gap_tree.accuracy(actual, actual) == 1.0
    always_zero = np.zeros(6, dtype=int)
    assert gap_tree.accuracy(always_zero, actual) == pytest.approx(1 / 3)
    # 只猜一類：該類 F1 = 0.5，其餘 0
    assert gap_tree.macro_f1(always_zero, actual) == pytest.approx(0.5 / 3)


# ---- gap_tree：洩漏檢查 ----


def test_feature_names_that_carry_the_target_are_rejected() -> None:
    temperature = {"airs_tsurf", "modis_lst"}
    ok = ["calendar_month", "model_is_gldas", "ctx:imerg_precip", "obs_state"]
    gap_tree.check_feature_names(
        ok, allow_target_lag=False, temperature_variables=temperature
    )
    for bad in (
        "model_anomaly",
        "obs_anomaly",
        "difference",
        "abs_difference",
        "ctx:airs_tsurf",
        gap_tree.TARGET_LAG,
    ):
        with pytest.raises(ValueError):
            gap_tree.check_feature_names(
                [*ok, bad], allow_target_lag=False, temperature_variables=temperature
            )
    gap_tree.check_feature_names(
        [*ok, gap_tree.TARGET_LAG],
        allow_target_lag=True,
        temperature_variables=temperature,
    )


def test_a_feature_that_contains_the_target_stops_the_run() -> None:
    rng = np.random.default_rng(0)
    gap = np.abs(rng.normal(size=600))
    low, high = gap_tree.class_thresholds(gap, 1 / 3, 2 / 3)
    y = gap_tree.classify(gap, low, high)
    harmless = rng.normal(size=(600, 2))
    gap_tree.check_single_feature_leak(harmless, y, ["a", "b"], PARAMS)
    leaking = np.column_stack([harmless, gap])
    with pytest.raises(ValueError, match="sneaky"):
        gap_tree.check_single_feature_leak(leaking, y, ["a", "b", "sneaky"], PARAMS)


def synthetic_inputs() -> tuple[
    list[gap_tree.Pair], dict[tuple[str, str], tuple[np.ndarray, np.ndarray]]
]:
    index = np.arange(2004 * 12, 2004 * 12 + 240, dtype=np.int64)
    pairs = []
    for number, station in enumerate(("a", "b", "c")):
        for model in ("gldas_tair", "merra2_t2m"):
            rng = np.random.default_rng(100 + number * 2 + (model == "gldas_tair"))
            obs = rng.normal(size=240)
            scale = 1.0 if model == "gldas_tair" else 0.3
            pairs.append(
                gap_tree.Pair(
                    pair_id=f"{model}__{station}",
                    model_variable=model,
                    station=station,
                    index=index,
                    model=obs + scale * rng.normal(size=240),
                    obs=obs,
                    context_point="p",
                    context_distance_km=1.0,
                )
            )
    context = {("rain", "p"): (index, np.random.default_rng(9).normal(size=240))}
    return pairs, context


def test_test_period_does_not_move_training_thresholds_or_rows() -> None:
    pairs, context = synthetic_inputs()
    variant = gap_tree.VARIANTS[0]
    train_months = set(range(2004 * 12, 2004 * 12 + 180))

    def rows(use: list[gap_tree.Pair]) -> dict:
        return gap_tree.build_rows(
            use,
            context,
            ["rain"],
            [2004 * 12 + 100],
            PARAMS,
            variant,
            train_months=train_months,
            train_stations=None,
            with_station=True,
        )

    changed = [
        gap_tree.Pair(
            **{
                **p.__dict__,
                "model": np.where(p.index >= 2004 * 12 + 180, p.model + 9.0, p.model),
            }
        )
        for p in pairs
    ]
    before, after = rows(pairs), rows(changed)
    assert before["thresholds"] == after["thresholds"]
    train = np.isin(before["months"], sorted(train_months))
    assert np.array_equal(before["x"][train], after["x"][train])
    assert np.array_equal(before["y"][train], after["y"][train])


def test_held_out_station_is_not_a_feature_and_not_in_training() -> None:
    pairs, context = synthetic_inputs()
    rows = gap_tree.build_rows(
        pairs,
        context,
        ["rain"],
        [],
        PARAMS,
        gap_tree.VARIANTS[1],
        train_months=None,
        train_stations={"a", "b"},
        with_station=False,
    )
    assert not any(name.startswith("station:") for name in rows["features"])
    assert gap_tree.SEGMENT not in rows["features"]
    test = rows["stations"] == "c"
    fold = gap_tree.evaluate_fold(
        rows,
        ~test,
        test,
        PARAMS,
        allow_target_lag=False,
        temperature_variables=set(),
    )
    assert fold["n_test"] == int(test.sum())
    assert fold["n_train"] + fold["n_test"] == rows["y"].size
    assert (
        sum(sum(row.values()) for row in fold["confusion_matrix_test"].values())
        == (fold["n_test"])
    )
    assert set(fold["baselines"]) == {"train_majority", "persistence", "calendar_month"}
    assert fold["above_all_baselines"] == all(
        fold[f"above_{name}"] for name in fold["baselines"]
    )


def test_describe_counts_every_month_once_per_grouping() -> None:
    pairs, _ = synthetic_inputs()
    out = gap_tree.describe(pairs, [2004 * 12 + 100], PARAMS)
    for rows in out.values():
        assert sum(row["n_months"] for row in rows) == 6 * 240
        for row in rows:
            assert row["ci"][0] <= row["mean_abs_difference"] <= row["ci"][1]
    by_product = {row["model"]: row for row in out["by_product"]}
    assert (
        by_product["gldas_tair"]["mean_abs_difference"]
        > (by_product["merra2_t2m"]["mean_abs_difference"])
    )


# ---- variable_graph ----


def graph_series() -> dict[tuple[str, str], tuple[np.ndarray, np.ndarray]]:
    index = np.arange(240, dtype=np.int64)
    series = {}
    for number, location in enumerate(("x", "y")):
        rng = np.random.default_rng(number)
        rain = rng.normal(size=240)
        series[("rain", location)] = (index, rain)
        series[("soil", location)] = (index, rain + 0.3 * rng.normal(size=240))
        series[("ozone", location)] = (index, rng.normal(size=240))
        series[("ndvi_a", location)] = (index, rng.normal(size=240))
        series[("ndvi_b", location)] = (index, series[("ndvi_a", location)][1] * 1.0)
    return series


def test_graph_keeps_related_pair_and_skips_same_quantity_pair() -> None:
    params = variable_graph.GraphParams(same_quantity_groups=(("ndvi_a", "ndvi_b"),))
    order = ["rain", "soil", "ozone", "ndvi_a", "ndvi_b"]
    table = variable_graph.table_graph(graph_series(), order, {"soil": ["x"]}, params)
    assert table["excluded_pairs"] == [
        {"source": "ndvi_a", "target": "ndvi_b", "reason": "same_quantity"}
    ]
    # 9 對可檢定 × （同月 1 ＋ 落後兩個方向 2）
    assert table["n_tests"] == 27
    edge = next(
        e
        for e in table["edges"]
        if (e["source"], e["target"], e["lag"]) == ("rain", "soil", 0)
    )
    assert edge["significant"] and edge["r"] > 0.9 and edge["known_issues"]
    assert edge["same_sign_in_all_locations"] and edge["n_locations"] == 2
    nodes = {n["variable_id"]: n for n in table["nodes"]}
    assert nodes["rain"]["component"] == nodes["soil"]["component"]
    assert nodes["rain"]["degree"] >= 1
    # 節點的分量與 union-find 對顯著邊算的一致
    ids = {n["variable_id"]: n["node_id"] for n in table["nodes"]}
    expected = mining_stats.components(
        list(ids.values()),
        [
            (ids[e["source"]], ids[e["target"]])
            for e in table["edges"]
            if e["significant"]
        ],
    )
    assert {n["node_id"]: n["component"] for n in table["nodes"]} == expected


# ---- similar_series ----


def test_similar_series_excludes_same_variable_and_same_quantity() -> None:
    params = similar_series.SimilarParams(
        top_k=2, bottom_k=1, same_quantity_groups=(("t_a", "t_b"),)
    )
    rng = np.random.default_rng(0)
    base = rng.normal(size=248)
    trend = np.linspace(-2, 2, 248)

    def item(variable: str, location: str, vector: np.ndarray) -> dict:
        return {
            "series_id": 0,
            "variable_id": variable,
            "location_id": location,
            "aggregation": "point",
            "location_name_en": location,
            "location_group": "taiwan",
            "known_issues": [],
            "n_filled": 0,
            "vector": vector,
        }

    pool = [
        item("t_a", "p", base),
        item("t_a", "q", base + 0.01 * rng.normal(size=248)),
        item("t_b", "p", base + 0.01 * rng.normal(size=248)),
        item("rain", "p", -base + 0.5 * rng.normal(size=248)),
        item("up_1", "p", trend + 0.3 * rng.normal(size=248)),
        item("up_2", "p", trend + 0.3 * rng.normal(size=248)),
    ]
    out = similar_series.build(pool, ["t_a", "t_b", "rain", "up_1", "up_2"], {}, params)
    listed = out["results"]["t_a__p__point"]
    names = [e["series"] for e in listed["most_similar"] + listed["least_similar"]]
    assert "t_a__q__point" not in names and "t_b__p__point" not in names
    assert listed["least_similar"][0]["series"] == "rain__p__point"
    assert listed["least_similar"][0]["cosine"] < -0.8
    # 兩條只有共同趨勢的序列：去趨勢前很像，去趨勢後不像，要被標出來
    shared = next(
        e
        for e in out["results"]["up_1__p__point"]["most_similar"]
        if e["series"] == "up_2__p__point"
    )
    assert shared["cosine"] > 0.8 and abs(shared["cosine_detrended"]) < 0.3
    assert shared["trend_sensitive"] and shared["significant"]
    assert out["summary"]["n_series"] == 6
    assert len(out["series"]["t_a__p__point"]["z"]) == 248


def test_similarity_of_standardised_vectors_is_the_correlation() -> None:
    rng = np.random.default_rng(1)
    a, b = rng.normal(size=248), rng.normal(size=248)
    vectors = np.array([mining_stats.standardize(a), mining_stats.standardize(b)])
    assert similar_series.similarity(vectors)[0, 1] == pytest.approx(
        np.corrcoef(a, b)[0, 1]
    )
