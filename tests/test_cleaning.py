"""清洗的純函式：骨架、旗標、距平、補值、摘要。不連資料庫。"""

import numpy as np
import pytest

from trend_detective import cleaning, trends
from trend_detective.cleaning import CleaningRules, KnownIssue

RULES = CleaningRules()
NAN = float("nan")


def month(index: int) -> str:
    return cleaning.index_month(2000 * 12 + index)


def points(values: list[float | None], **extra: object) -> list[dict[str, object]]:
    return [
        {"month": month(i), "value": v, "n_samples": 1, "coverage": 1.0, **extra}
        for i, v in enumerate(values)
    ]


def clean(pts: list[dict[str, object]], **options: object) -> cleaning.CleanedSeries:
    arguments: dict[str, object] = {
        "variable_id": "x",
        "retrieved_at": "2030-01-01T00:00:00Z",
        "rules": RULES,
        "issues": [],
        **options,
    }
    return cleaning.clean_series(pts, **arguments)  # pyright: ignore[reportArgumentType]


def test_gap_runs_ignore_leading_and_trailing_unusable_months() -> None:
    usable = np.array([False, True, False, False, True, True, False, True, False])
    assert cleaning.gap_runs(usable) == [(2, 2), (6, 1)]
    assert cleaning.gap_runs(np.array([False, False])) == []


def test_short_gaps_are_interpolated_and_long_gaps_get_climatology() -> None:
    anomalies = np.array([NAN, 1.0, NAN, NAN, 4.0, NAN, NAN, NAN, 2.0, NAN])
    filled, methods = cleaning.fill_anomalies(anomalies, max_linear_gap=2)
    # 兩個月的缺口：1 → 4 之間線性內插
    assert filled[2:4] == pytest.approx([2.0, 3.0])
    assert methods[2:4] == ["linear", "linear"]
    # 三個月的缺口：補距平 0（月氣候值）
    assert filled[5:8].tolist() == [0.0, 0.0, 0.0]
    assert methods[5:8] == ["climatology"] * 3
    # 頭尾不外推，原本有值的不動
    assert np.isnan(filled[0]) and np.isnan(filled[-1])
    assert methods[0] is None and methods[-1] is None
    assert filled[[1, 4, 8]].tolist() == [1.0, 4.0, 2.0]
    assert [methods[i] for i in (1, 4, 8)] == [None, None, None]


def test_fill_never_carries_the_previous_month_forward() -> None:
    anomalies = np.array([5.0, NAN, 1.0])
    filled, _ = cleaning.fill_anomalies(anomalies, max_linear_gap=2)
    assert filled[1] == pytest.approx(3.0)


def test_skeleton_marks_absent_months_and_null_values_as_missing() -> None:
    pts = points([1.0, None, 3.0, 4.0])
    del pts[2]  # 序列檔沒有這個月
    cleaned = clean(pts)
    assert cleaned.n_months == 4
    assert cleaned.qc_flag == ["ok", "missing", "missing", "ok"]
    assert cleaned.in_source.tolist() == [True, True, False, True]
    assert np.isnan(cleaned.value_raw[1]) and np.isnan(cleaned.value_clean[2])
    assert cleaned.value_raw[[0, 3]].tolist() == [1.0, 4.0]


def test_low_coverage_is_unusable_but_the_raw_value_is_kept() -> None:
    pts = points([1.0, 2.0, 3.0])
    pts[1]["coverage"] = 0.1
    cleaned = clean(pts)
    assert cleaned.qc_flag == ["ok", "low_coverage", "ok"]
    assert cleaned.value_raw[1] == 2.0
    assert np.isnan(cleaned.value_clean[1])


def test_months_not_finished_at_retrieval_are_partial() -> None:
    cleaned = clean(points([1.0, 2.0, 3.0]), retrieved_at="2000-02-14T08:00:00Z")
    # 2000-02 取得時還沒過完；2000-03 更不可能完整
    assert cleaned.qc_flag == ["ok", "partial_month", "partial_month"]
    assert np.isnan(cleaned.value_clean[1])
    assert clean(points([1.0, 2.0]), retrieved_at=None).qc_flag == ["ok", "ok"]


def test_anomaly_matches_the_trend_statistics() -> None:
    rng = np.random.default_rng(0)
    values = [float(v) for v in rng.normal(size=60)]
    pts = points(values)  # pyright: ignore[reportArgumentType]
    pts[7]["value"] = None
    pts[20]["coverage"] = 0.0
    cleaned = clean(pts)
    prepared = trends.prepare(pts, trends.TrendParams())  # pyright: ignore[reportArgumentType]
    usable = ~np.isnan(cleaned.value_clean)
    assert cleaned.index[usable].tolist() == prepared.index.tolist()
    assert cleaned.anomaly[usable] == pytest.approx(prepared.anomalies, abs=1e-12)
    # 給趨勢統計的輸入就是可用月份
    assert [p["month"] for p in cleaning.clean_points(cleaned)] == [
        trends.index_month(int(i)) for i in prepared.index
    ]


def test_outliers_are_flagged_by_robust_z_and_not_removed() -> None:
    rng = np.random.default_rng(1)
    values = [float(v) for v in rng.normal(size=120)]
    values[50] = 40.0
    cleaned = clean(points(values))  # pyright: ignore[reportArgumentType]
    assert cleaned.qc_flag[50] == "outlier_suspect"
    assert cleaned.value_clean[50] == 40.0
    assert cleaned.qc_flag.count("outlier_suspect") == 1


def test_constant_series_has_no_outliers() -> None:
    assert set(clean(points([2.0] * 30)).qc_flag) == {"ok"}


def test_known_discontinuity_flags_only_the_listed_period() -> None:
    issue = KnownIssue(
        id="step",
        kind="discontinuity",
        variable_id="x",
        period_start=month(2),
        period_end=month(3),
        flag_months=True,
        summary_en="",
        source_doc="doc",
    )
    cleaned = clean(points([1.0, 2.0, 3.0, 4.0, 5.0]), issues=[issue])
    assert cleaned.qc_flag == ["ok", "ok", *["known_discontinuity"] * 2, "ok"]
    assert cleaned.known_issue_ids == ("step",)
    assert not np.isnan(cleaned.value_clean).any()
    assert (
        clean(points([1.0, 2.0, 3.0]), variable_id="y", issues=[issue]).qc_flag
        == ["ok"] * 3
    )


def test_issue_scope_by_pattern_and_aggregation() -> None:
    auxiliary = KnownIssue(
        id="counts",
        kind="auxiliary",
        variable_pattern="_ct$",
        summary_en="",
        source_doc="doc",
    )
    point_only = KnownIssue(
        id="p",
        kind="missing_composites",
        variable_id="lst",
        aggregation="point",
        summary_en="",
        source_doc="doc",
    )
    issues = [auxiliary, point_only]
    assert cleaning.is_auxiliary("airs_cloud_ct", issues)
    assert not cleaning.is_auxiliary("airs_ctp", issues)
    assert cleaning.issues_for("lst", issues, "point") == [point_only]
    assert cleaning.issues_for("lst", issues, "area_mean") == []
    assert clean(points([1.0]), variable_id="a_ct", issues=issues).auxiliary


def test_summary_counts_flags_fills_and_longest_gap() -> None:
    values: list[float | None] = [float(i % 5) for i in range(40)]
    for i in (5, 10, 11, 12, 13):
        values[i] = None
    cleaned = clean(points(values))
    summary = cleaning.summarize(cleaned, RULES)
    assert summary["n_months"] == 40
    assert summary["n_by_flag"]["missing"] == 5
    assert sum(summary["n_by_flag"].values()) == 40
    assert summary["n_filled_linear"] == 1
    assert summary["n_filled_climatology"] == 4
    assert summary["longest_gap_months"] == 4
    assert summary["n_gaps"] == 2
    assert summary["fill_fraction"] == pytest.approx(5 / 40)
    assert summary["mining_eligible"] is True


def test_series_with_too_many_filled_months_is_not_eligible_for_mining() -> None:
    values: list[float | None] = [1.0, *[None] * 5, 2.0, 3.0, 4.0, 5.0]
    summary = cleaning.summarize(clean(points(values)), RULES)
    assert summary["fill_fraction"] == pytest.approx(0.5)
    assert summary["mining_eligible"] is False


def test_empty_series_and_seed_file() -> None:
    assert clean([]).n_months == 0
    rules, issues = cleaning.load_seed()
    assert rules == RULES
    ids = {issue.id for issue in issues}
    assert {"gldas_tair_step_2011_05", "gldas_evap_step_2024_07_2025_06"} <= ids
    # 每筆已知問題都要有出處文件，而且文件存在
    from pathlib import Path

    assert all(Path(issue.source_doc).exists() for issue in issues)
