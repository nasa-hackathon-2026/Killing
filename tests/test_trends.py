"""趨勢統計（#55）：用已知答案的合成序列驗證，不連網。"""

import json
import math
from pathlib import Path

import numpy as np
import pytest

from trend_detective.trends import (
    TrendParams,
    analyze_points,
    analyze_snapshot,
    apply_fdr,
    benjamini_hochberg,
    fdr_groups,
    lag1_autocorrelation,
    main,
    ols_trend,
    prepare,
)

PARAMS = TrendParams()


def months(n: int, start_year: int = 2001, start_month: int = 1) -> list[str]:
    out = []
    for i in range(n):
        total = start_year * 12 + start_month - 1 + i
        out.append(f"{total // 12:04d}-{total % 12 + 1:02d}-01")
    return out


def points(values, *, start_month: int = 1, coverage=None) -> list[dict]:
    """`values` 裡的 None 是缺值；`coverage` 沒給就是 1。"""
    labels = months(len(values), start_month=start_month)
    return [
        {
            "month": label,
            "value": None if value is None else float(value),
            "n_samples": 0 if value is None else 1,
            "coverage": (0 if value is None else 1)
            if coverage is None
            else coverage[i],
        }
        for i, (label, value) in enumerate(zip(labels, values, strict=True))
    ]


def seasonal_cycle(n: int, amplitude: float) -> np.ndarray:
    return amplitude * np.sin(2 * np.pi * np.arange(n) / 12)


def ar1_noise(rng: np.random.Generator, n: int, phi: float) -> np.ndarray:
    noise = np.empty(n)
    noise[0] = rng.normal() / math.sqrt(1 - phi**2)
    for i in range(1, n):
        noise[i] = phi * noise[i - 1] + rng.normal()
    return noise


def test_anomaly_is_value_minus_mean_of_same_calendar_month():
    # 兩年、只有一月與二月有值：一月 1、3（平均 2），二月 10、20（平均 15）
    values = [1, 10] + [None] * 10 + [3, 20]
    prepared = prepare(points(values), PARAMS)

    assert prepared.anomalies.tolist() == [-1, -5, 1, 5]
    assert prepared.index.tolist() == [
        2001 * 12,
        2001 * 12 + 1,
        2002 * 12,
        2002 * 12 + 1,
    ]
    assert prepared.n_null == 10


def test_low_coverage_and_null_months_are_excluded_and_counted():
    values = [5.0, 999.0, None, 7.0]
    coverage = [1, 0.1, 0, 0.25]
    prepared = prepare(points(values, coverage=coverage), PARAMS)

    # 0.1 低於預設門檻 0.25 被排除；剛好等於門檻的月份保留
    assert prepared.values.tolist() == [5.0, 7.0]
    assert (prepared.n_null, prepared.n_low_coverage, prepared.n_valid) == (1, 1, 2)
    assert prepared.span_months == 4
    assert prepared.missing_fraction == pytest.approx(0.5)


def test_coverage_threshold_is_adjustable():
    values = [5.0, 999.0, 7.0]
    prepared = prepare(
        points(values, coverage=[1, 0.1, 1]), TrendParams(min_coverage=0.05)
    )

    assert prepared.n_low_coverage == 0
    assert prepared.n_valid == 3


def test_lag1_autocorrelation_only_pairs_adjacent_months():
    # 月序 0,1,2,(缺 3),4,5：相鄰配對是 (a0,a1)、(a1,a2)、(a4,a5)
    index = np.array([0, 1, 2, 4, 5])
    residuals = np.array([1.0, 2.0, 4.0, -3.0, 0.0])
    expected = np.corrcoef([1.0, 2.0, -3.0], [2.0, 4.0, 0.0])[0, 1]

    assert lag1_autocorrelation(index, residuals) == pytest.approx(expected)


def test_known_slope_with_seasonal_cycle_and_noise_is_recovered():
    # 真值：每年 +0.03（每十年 +0.3），季節振幅 5、白雜訊標準差 0.5、20 年
    rng = np.random.default_rng(1)
    n = 240
    values = 0.03 * np.arange(n) / 12 + seasonal_cycle(n, 5) + rng.normal(0, 0.5, n)
    result = analyze_points(points(values), PARAMS)

    assert result["status"] == "analyzed"
    low, high = result["ols"]["ci_per_decade"]
    assert low < 0.3 < high
    assert result["ols"]["slope_per_decade"] == pytest.approx(0.3, abs=0.12)
    assert result["ols"]["p"] < 0.05
    sen_low, sen_high = result["sen"]["ci_per_decade"]
    assert sen_low < 0.3 < sen_high
    assert result["mann_kendall"]["hamed_rao"]["p"] < 0.05
    assert result["mann_kendall"]["seasonal"]["p"] < 0.05


def test_confidence_interval_covers_true_slope_at_about_the_nominal_rate():
    # 白雜訊下 95% 信賴區間應該涵蓋真值約 95% 的次數；200 次模擬容許 90% 至 99%
    n = 240
    covered = 0
    for seed in range(200):
        rng = np.random.default_rng(seed)
        values = 0.05 * np.arange(n) / 12 + rng.normal(0, 1, n)
        low, high = analyze_ols(values)["ci_per_decade"]
        covered += low < 0.5 < high
    assert 0.90 <= covered / 200 <= 0.99


def analyze_ols(values: np.ndarray) -> dict:
    prepared = prepare(points(values), PARAMS)
    return ols_trend(prepared.index, prepared.anomalies, PARAMS.alpha)


def test_noiseless_trend_with_seasonal_cycle_gives_exact_seasonal_sen_slope():
    # 沒有雜訊：每個月份隔一年的差都是 0.04，所以 Seasonal MK 的斜率剛好每十年 0.4
    n = 180
    values = 0.04 * np.arange(n) / 12 + seasonal_cycle(n, 10)
    result = analyze_points(points(values), PARAMS)

    assert result["mann_kendall"]["seasonal"]["slope_per_decade"] == pytest.approx(0.4)
    assert result["ols"]["slope_per_decade"] == pytest.approx(0.4, rel=0.02)
    assert result["sen"]["slope_per_decade"] == pytest.approx(0.4, rel=0.02)


def test_strong_seasonal_cycle_without_trend_is_not_reported_as_a_trend():
    # 季節振幅是雜訊的 20 倍、起訖月份不對稱（3 月起、共 250 個月）、沒有趨勢。
    # 直接對原始值回歸會受季節相位影響；距平後 100 次模擬的誤判率應接近 5%
    n = 250
    false_positive = 0
    for seed in range(100):
        rng = np.random.default_rng(seed)
        values = 300 + seasonal_cycle(n, 10) + rng.normal(0, 0.5, n)
        prepared = prepare(points(values, start_month=3), PARAMS)
        result = ols_trend(prepared.index, prepared.anomalies, PARAMS.alpha)
        false_positive += result["p"] < 0.05
        assert abs(result["slope_per_decade"]) < 0.3
    assert false_positive <= 12


def test_autocorrelation_correction_keeps_false_positive_rate_near_nominal():
    # AR(1)，phi = 0.7，沒有趨勢。未修正的 t 檢定會把很多序列判成顯著；
    # 修正後應回到接近 5%（有限樣本下略高，容許到 10%）
    n = 240
    uncorrected = 0
    corrected = 0
    for seed in range(300):
        result = analyze_ols(ar1_noise(np.random.default_rng(seed), n, 0.7))
        uncorrected += result["p_uncorrected"] < 0.05
        corrected += result["p"] < 0.05
        assert result["n_effective"] < n
    assert uncorrected / 300 > 0.25
    assert corrected / 300 < 0.10


def test_hamed_rao_rejects_less_often_than_original_mk_on_autocorrelated_noise():
    n = 240
    original = 0
    hamed_rao = 0
    for seed in range(60):
        values = ar1_noise(np.random.default_rng(seed), n, 0.7)
        result = analyze_points(points(values), PARAMS)["mann_kendall"]
        original += result["original"]["p"] < 0.05
        p = result["hamed_rao"]["p"]
        hamed_rao += p is not None and p < 0.05
    # 實測（phi = 0.7、240 個月）Hamed-Rao 把誤判率壓低，但仍高於名目的 5%，
    # 所以這裡只斷言「比原始 MK 少」，不斷言回到 5%
    assert original / 60 > 0.25
    assert hamed_rao < original


def test_negative_autocorrelation_does_not_shrink_the_interval():
    # r1 < 0 時 n_eff 不超過 n，修正後的區間不會比未修正的窄
    rng = np.random.default_rng(3)
    noise = rng.normal(0, 1, 241)
    values = noise[1:] - 0.6 * noise[:-1]
    result = analyze_ols(values)

    assert result["lag1_autocorrelation"] < 0
    assert result["n_effective"] == 240
    assert result["ci_per_decade"] == pytest.approx(result["ci_per_decade_uncorrected"])


def test_outlier_in_a_low_coverage_month_does_not_change_the_result():
    rng = np.random.default_rng(5)
    n = 240
    clean = 0.03 * np.arange(n) / 12 + rng.normal(0, 0.5, n)
    dirty = clean.copy()
    dirty[200] = 500.0
    coverage = [1.0] * n
    coverage[200] = 0.1
    with_gap = [None if i == 200 else v for i, v in enumerate(clean)]

    excluded = analyze_points(points(dirty, coverage=coverage), PARAMS)
    reference = analyze_points(points(with_gap), PARAMS)

    assert excluded["data"]["n_low_coverage"] == 1
    assert excluded["ols"] == reference["ols"]
    assert excluded["sen"] == reference["sen"]


def test_short_series_is_marked_insufficient_with_a_reason():
    result = analyze_points(points(np.arange(119.0)), PARAMS)

    assert result["status"] == "insufficient"
    assert result["reason"]["code"] == "too_few_months"
    assert "119" in result["reason"]["text_en"]
    assert "ols" not in result


def test_series_with_too_many_excluded_months_is_marked_insufficient():
    # 300 個月裡每 4 個月有 1 個低覆蓋：可用 225 個月，但缺 25% > 20%
    n = 300
    coverage = [0.1 if i % 4 == 1 else 1.0 for i in range(n)]
    result = analyze_points(points(np.arange(float(n)), coverage=coverage), PARAMS)

    assert result["status"] == "insufficient"
    assert result["reason"]["code"] == "too_many_missing"
    assert result["data"]["n_low_coverage"] == 75


def test_benjamini_hochberg_matches_hand_calculation():
    # 排序後 0.005、0.01、0.03、0.04，乘 m/rank：0.02、0.02、0.04、0.04
    assert benjamini_hochberg([0.01, 0.04, 0.03, 0.005]) == pytest.approx(
        [0.02, 0.04, 0.04, 0.02]
    )


def test_fdr_reports_raw_and_adjusted_significance_and_skips_insufficient():
    def analyzed(p: float) -> dict:
        tests = {name: {"p": p} for name in ("original", "hamed_rao", "seasonal")}
        return {"status": "analyzed", "ols": {"p": p}, "mann_kendall": tests}

    # 0.02、0.04、0.9 的 BH 校正：0.06、0.06、0.9
    results = {
        "a": analyzed(0.02),
        "b": analyzed(0.04),
        "c": analyzed(0.9),
        "d": {"status": "insufficient"},
    }
    results["b"]["mann_kendall"]["hamed_rao"]["p"] = None
    apply_fdr(results, 0.05)

    assert results["a"]["ols"]["p_fdr"] == pytest.approx(0.06)
    assert results["a"]["ols"]["significant"] is True
    assert results["a"]["ols"]["significant_fdr"] is False
    assert results["c"]["ols"]["significant"] is False
    assert results["d"] == {"status": "insufficient"}
    # 算不出 p 的檢定不列入：剩 0.02、0.9 兩個，校正後 0.04、0.9
    assert results["b"]["mann_kendall"]["hamed_rao"]["significant_fdr"] is None
    assert results["a"]["mann_kendall"]["hamed_rao"]["p_fdr"] == pytest.approx(0.04)


def test_fdr_can_be_applied_separately_within_each_aggregation():
    def analyzed(p: float, aggregation: str) -> dict:
        tests = {name: {"p": p} for name in ("original", "hamed_rao", "seasonal")}
        return {
            "status": "analyzed",
            "aggregation": aggregation,
            "ols": {"p": p},
            "mann_kendall": tests,
        }

    results = {
        "a": analyzed(0.02, "point"),
        "b": analyzed(0.04, "point"),
        "c": analyzed(0.9, "point"),
        "d": analyzed(0.03, "area_mean_grid"),
    }
    groups = fdr_groups(results, "aggregation")
    apply_fdr(results, 0.05, groups)

    assert groups == {"area_mean_grid": ["d"], "point": ["a", "b", "c"]}
    # point 組：0.02、0.04、0.9 → 0.06、0.06、0.9；area_mean_grid 組只有一條，q = p
    assert results["a"]["ols"]["p_fdr"] == pytest.approx(0.06)
    assert results["b"]["ols"]["significant_fdr"] is False
    assert results["d"]["ols"]["p_fdr"] == pytest.approx(0.03)
    assert results["d"]["ols"]["significant_fdr"] is True
    # 整批一組時是 0.02、0.03、0.04、0.9：0.03 × 4 ÷ 2 = 0.06，再被後一名的
    # 0.04 × 4 ÷ 3 = 0.0533 壓低（BH 的單調化），仍不顯著
    apply_fdr(results, 0.05)
    assert results["d"]["ols"]["p_fdr"] == pytest.approx(0.16 / 3)
    assert results["d"]["ols"]["significant_fdr"] is False


def test_unknown_fdr_grouping_is_rejected():
    with pytest.raises(ValueError):
        fdr_groups({}, "variable_id")


def write_snapshot(root: Path) -> None:
    rng = np.random.default_rng(11)
    n = 150
    trend = 0.05 * np.arange(n) / 12 + rng.normal(0, 0.3, n)
    series = {
        "temp__here__point": ("K", points(trend)),
        "short__here__point": ("mm/hr", points(np.arange(24.0))),
    }
    entries = []
    for key, (unit, series_points) in series.items():
        variable, location, aggregation = key.split("__")
        file = f"series/{key}.json"
        entries.append(
            {
                "variable_id": variable,
                "location_id": location,
                "aggregation": aggregation,
                "file": file,
            }
        )
        (root / "series").mkdir(parents=True, exist_ok=True)
        (root / file).write_text(json.dumps({"unit": unit, "points": series_points}))
    catalog = {"series": entries, "snapshot": {"generated_at": "2026-11-14T00:00:00Z"}}
    (root / "catalog.json").write_text(json.dumps(catalog))


def test_snapshot_analysis_is_keyed_by_series_and_records_inputs(tmp_path: Path):
    write_snapshot(tmp_path)
    trends, anomalies = analyze_snapshot(tmp_path, PARAMS)

    assert sorted(trends["series"]) == ["short__here__point", "temp__here__point"]
    assert trends["input"]["snapshot_generated_at"] == "2026-11-14T00:00:00Z"
    assert trends["parameters"]["min_coverage"] == 0.25
    assert trends["series"]["temp__here__point"]["unit"] == "K"
    assert trends["series"]["short__here__point"]["status"] == "insufficient"
    assert trends["summary"]["n_analyzed"] == 1
    assert trends["summary"]["insufficient_by_reason"] == {"too_few_months": 1}
    assert anomalies["series"]["temp__here__point"]["first_month"] == "2001-01-01"
    assert len(anomalies["series"]["temp__here__point"]["values"]) == 150


def test_rerun_changes_only_the_run_record_timestamp(tmp_path: Path):
    snapshot = tmp_path / "snapshot"
    out = tmp_path / "analysis"
    write_snapshot(snapshot)
    args = ["--snapshot-dir", str(snapshot), "--analysis-dir", str(out)]

    assert main(args) == 0
    first = {p.name: p.read_bytes() for p in out.iterdir()}
    assert main(args) == 0
    second = {p.name: p.read_bytes() for p in out.iterdir()}

    assert first["trends.json"] == second["trends.json"]
    assert first["anomalies.json"] == second["anomalies.json"]
    run = json.loads(second["trends.run.json"])
    assert run["parameters"] == json.loads(second["trends.json"])["parameters"]
    assert "generated_at" in run
    assert "generated_at" not in json.loads(second["trends.json"])


def test_grouped_run_records_groups_and_can_skip_anomalies_and_use_workers(
    tmp_path: Path,
):
    snapshot = tmp_path / "extended"
    out = tmp_path / "analysis"
    write_snapshot(snapshot)
    args = ["--snapshot-dir", str(snapshot), "--analysis-dir", str(out)]

    assert main([*args, "--fdr-group", "aggregation", "--no-anomalies"]) == 0
    serial = json.loads((out / "trends.json").read_text())
    assert (
        main([*args, "--fdr-group", "aggregation", "--no-anomalies", "--workers", "2"])
        == 0
    )
    parallel = json.loads((out / "trends.json").read_text())

    assert sorted(p.name for p in out.iterdir()) == ["trends.json", "trends.run.json"]
    assert parallel == serial
    assert serial["fdr"] == {
        "group_by": "aggregation",
        "n_series_by_group": {"point": 2},
    }
    assert serial["summary_by_group"]["point"]["n_analyzed"] == 1
    assert "same aggregation" in serial["methods"]["fdr"]
    run = json.loads((out / "trends.run.json").read_text())
    assert run["outputs"] == ["trends.json"]
    assert run["summary_by_group"] == serial["summary_by_group"]


def test_default_run_has_no_group_fields(tmp_path: Path):
    write_snapshot(tmp_path)
    trends, _ = analyze_snapshot(tmp_path, PARAMS)

    assert "fdr" not in trends and "summary_by_group" not in trends
