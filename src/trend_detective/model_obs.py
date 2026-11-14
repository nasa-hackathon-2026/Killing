"""模式推算 vs 觀測（#97）：同一地點、同一個物理量的模式序列與觀測序列配對，算共同期間的對照統計量。

    uv run python -m trend_detective.model_obs     # 要先有 pg load、pg clean

規則是資料（`data/seed/model_obs_pairs.json`）。結果寫到資料庫的 `analysis.model_obs_pairs`，並匯出
`data/analysis/model_vs_obs.json`（加 `.run.json`）給網站讀。做法與限制見 `docs/data/model-vs-obs.md`。

算法（純函式，不連資料庫；測試在 `tests/test_model_obs.py`）：

1. 共同期間：視窗（預設 2001-01 至 2025-12）內兩條序列都有值的月份。只用這些月份。
2. 距平：兩條序列各自在共同月份上取每個日曆月的平均（月氣候值），再相減。兩邊用同一批月份、
   各自的氣候值，所以基期不同（GISTEMP 是 1951–1980）、絕對值與距平、°C 與 K 都能比；
   代價是兩條距平在共同期間的平均都是 0，差值的平均也是 0（絕對偏差不在這裡）。
3. 統計量：距平的 Pearson 相關；差值（模式 − 觀測）的平均、標準差、RMSE；兩條距平各自的最小平方法
   趨勢與 95% 信賴區間（`trends.ols_trend`，lag-1 自相關修正，和趨勢統計同一個函式）；趨勢差；
   差值序列本身的趨勢與是否顯著（p < alpha）。
4. 最大階梯：差值序列在每個月份 m 算「m 起 6 個月的平均 − m 之前 6 個月的平均」（兩邊各至少要有
   4 個月有值），取絕對值最大的那個月（沿用 `docs/data/gldas-tair-check.md` 的做法）。

模式那一邊有兩種來源：`series`（資料庫裡清洗後的序列，`value_clean`）與 `grid_cube_cell`
（測站沒有對應的模式點位序列時，從全球格點立方體 `data/raw/grid/<id>/<id>.nc` 取測站座標所在格
的月值；那一格整條都沒有值——例如 GLDAS 只有陸地——就取 2 格內最近、有值的格子，並記下距離）。
"""

import argparse
import json
import math
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np
from scipy import stats

from trend_detective import cleaning, trends
from trend_detective.snapshot import RAW_DIR, SEED_DIR

PAIRS_SEED = SEED_DIR / "model_obs_pairs.json"
OUTPUT_NAME = "model_vs_obs.json"
SCHEMA_VERSION = 1
SOURCE_SERIES = "series"
SOURCE_CUBE = "grid_cube_cell"
EARTH_RADIUS_KM = 6371.0088


@dataclass(frozen=True)
class PairParams:
    window_start: str = "2001-01-01"
    window_end: str = "2025-12-01"
    # 共同月份少於這個數就不算統計量（沿用趨勢統計的 10 年下限）
    min_common_months: int = 120
    alpha: float = 0.05
    step_half_window_months: int = 6
    step_min_months_per_side: int = 4


@dataclass(frozen=True)
class PairSpec:
    """一對要比的序列。`model_location_id` 是模式序列所在的地點（`series` 來源才用）。"""

    pair_id: str
    group: str
    quantity: str
    location_id: str
    model_variable_id: str
    model_source: str
    model_aggregation: str | None
    model_location_id: str
    cube_id: str | None
    obs_variable_id: str
    obs_aggregation: str
    monthly: bool


def series_key(variable_id: str, location_id: str, aggregation: str) -> str:
    return f"{variable_id}__{location_id}__{aggregation}"


def load_rules(path: Path = PAIRS_SEED) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def params_from(rules: dict[str, Any]) -> PairParams:
    return PairParams(**rules.get("parameters", {}))


def expand_pairs(rules: dict[str, Any], available: set[str]) -> list[PairSpec]:
    """把規則展開成配對。`available` 是現有序列的鍵（`變數__地點__聚合`）。

    觀測序列不存在的組合略過（例如拉哥斯沒有 GHCNm）；`series` 來源的模式序列不存在也略過。
    `grid_cube_cell` 的模式值到算的時候才從立方體取，這裡不檢查。
    """
    pairs: list[PairSpec] = []
    for group in rules["groups"]:
        for location_id in group["locations"]:
            for obs in group["observations"]:
                obs_key = series_key(
                    obs["variable_id"], location_id, obs["aggregation"]
                )
                if obs_key not in available:
                    continue
                for model in group["models"]:
                    source = model.get("source", SOURCE_SERIES)
                    model_location = model.get("location_map", {}).get(
                        location_id, location_id
                    )
                    only = model.get("only_locations")
                    if only is not None and location_id not in only:
                        continue
                    if source == SOURCE_SERIES and (
                        series_key(
                            model["variable_id"], model_location, model["aggregation"]
                        )
                        not in available
                    ):
                        continue
                    pairs.append(
                        PairSpec(
                            pair_id=f"{model['variable_id']}__{obs['variable_id']}"
                            f"__{location_id}",
                            group=group["id"],
                            quantity=group["quantity"],
                            location_id=location_id,
                            model_variable_id=model["variable_id"],
                            model_source=source,
                            model_aggregation=model.get("aggregation"),
                            model_location_id=model_location,
                            cube_id=model.get("cube_id"),
                            obs_variable_id=obs["variable_id"],
                            obs_aggregation=obs["aggregation"],
                            monthly=bool(group.get("monthly", True)),
                        )
                    )
    return pairs


# ---------------------------------------------------------------- 統計（純函式）


def to_index_map(points: list[tuple[str, float | None]]) -> dict[int, float]:
    """[(月份 ISO 字串, 值)] → {月份索引: 值}；None 與 NaN 的月份不放。"""
    found: dict[int, float] = {}
    for month, value in points:
        if value is None or not math.isfinite(value):
            continue
        found[cleaning.month_index(month)] = float(value)
    return found


def common_anomalies(
    model: dict[int, float], obs: dict[int, float], params: PairParams
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """回傳 (共同月份索引, 模式距平, 觀測距平)。距平是減去共同月份上各自的月氣候值。"""
    first = cleaning.month_index(params.window_start)
    last = cleaning.month_index(params.window_end)
    index = np.array(
        sorted(i for i in model if i in obs and first <= i <= last), dtype=np.int64
    )
    if index.size == 0:
        empty = np.array([], dtype=np.float64)
        return index, empty, empty
    model_values = np.array([model[int(i)] for i in index])
    obs_values = np.array([obs[int(i)] for i in index])
    return (
        index,
        cleaning.monthly_anomalies(index, model_values),
        cleaning.monthly_anomalies(index, obs_values),
    )


def largest_step(
    index: np.ndarray, values: np.ndarray, params: PairParams
) -> tuple[float | None, int | None]:
    """差值序列的最大階梯：(之後 6 個月平均 − 之前 6 個月平均, 新的一段開始的月份索引)。"""
    if index.size == 0:
        return None, None
    half = params.step_half_window_months
    first, last = int(index[0]), int(index[-1])
    grid = np.full(last - first + 1, np.nan)
    grid[index - first] = values
    best: float | None = None
    best_month: int | None = None
    for position in range(half, grid.size - half + 1):
        before = grid[position - half : position]
        after = grid[position : position + half]
        n_before = int(np.isfinite(before).sum())
        n_after = int(np.isfinite(after).sum())
        if min(n_before, n_after) < params.step_min_months_per_side:
            continue
        step = float(np.nanmean(after) - np.nanmean(before))
        if best is None or abs(step) > abs(best):
            best, best_month = step, first + position
    return best, best_month


def _trend(index: np.ndarray, values: np.ndarray, alpha: float) -> dict[str, Any]:
    if np.ptp(values) == 0:
        return {"slope_per_decade": 0.0, "ci_per_decade": [0.0, 0.0], "p": 1.0}
    result = trends.ols_trend(index, values, alpha)
    return {
        "slope_per_decade": result["slope_per_decade"],
        "ci_per_decade": result["ci_per_decade"],
        "p": result["p"],
    }


def pair_statistics(
    model: dict[int, float], obs: dict[int, float], params: PairParams
) -> dict[str, Any]:
    """一對序列的全部統計量，加上逐月的兩條距平與差值（`monthly`，從第一個共同月份起的連續月份）。"""
    index, model_anomaly, obs_anomaly = common_anomalies(model, obs, params)
    n = int(index.size)
    base: dict[str, Any] = {
        "n_common_months": n,
        "first_common_month": cleaning.index_month(int(index[0])) if n else None,
        "last_common_month": cleaning.index_month(int(index[-1])) if n else None,
    }
    if n < params.min_common_months:
        return {**base, "status": "insufficient"}
    diff = model_anomaly - obs_anomaly
    correlation = (
        float(stats.pearsonr(model_anomaly, obs_anomaly)[0])  # pyright: ignore[reportArgumentType]
        if np.ptp(model_anomaly) > 0 and np.ptp(obs_anomaly) > 0
        else None
    )
    model_trend = _trend(index, model_anomaly, params.alpha)
    obs_trend = _trend(index, obs_anomaly, params.alpha)
    diff_trend = _trend(index, diff, params.alpha)
    step, step_month = largest_step(index, diff, params)
    first, last = int(index[0]), int(index[-1])
    length = last - first + 1

    def on_grid(values: np.ndarray) -> list[float | None]:
        grid: list[float | None] = [None] * length
        for i, value in zip(index, values, strict=True):
            grid[int(i) - first] = round(float(value), 3)
        return grid

    return {
        **base,
        "status": "analyzed",
        "correlation": correlation,
        "difference": {
            "mean": float(diff.mean()),
            "sd": float(diff.std(ddof=1)),
            "rmse": float(np.sqrt((diff**2).mean())),
            "trend": {
                **diff_trend,
                "significant": bool(diff_trend["p"] < params.alpha),
            },
            "largest_step": step,
            "largest_step_month": cleaning.index_month(step_month)
            if step_month is not None
            else None,
        },
        "model_trend": model_trend,
        "obs_trend": obs_trend,
        "slope_difference": model_trend["slope_per_decade"]
        - obs_trend["slope_per_decade"],
        "monthly": {
            "first_month": cleaning.index_month(first),
            "model_anomaly": on_grid(model_anomaly),
            "obs_anomaly": on_grid(obs_anomaly),
            "difference": on_grid(diff),
        },
    }


def annual_means(monthly: dict[str, Any], min_months: int = 9) -> dict[str, Any]:
    """逐月的距平與差值 → 逐年平均（當年共同月份不到 `min_months` 個就是 None）。"""
    first = cleaning.month_index(monthly["first_month"])
    names = ("model_anomaly", "obs_anomaly", "difference")
    length = len(monthly["difference"])
    first_year = first // 12
    last_year = (first + length - 1) // 12
    result: dict[str, Any] = {
        "first_year": first_year,
        "min_months_per_year": min_months,
        **{name: [] for name in names},
    }
    for year in range(first_year, last_year + 1):
        positions = [
            i - first
            for i in range(year * 12, year * 12 + 12)
            if 0 <= i - first < length
        ]
        for name in names:
            values = [
                monthly[name][p] for p in positions if monthly[name][p] is not None
            ]
            result[name].append(
                round(sum(values) / len(values), 3)
                if len(values) >= min_months
                else None
            )
    return result


# ---------------------------------------------------------------- 立方體取值


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def nearest_cell_with_values(
    lat_axis: np.ndarray,
    lon_axis: np.ndarray,
    has_values: np.ndarray,
    lat: float,
    lon: float,
    max_cells: int = 2,
) -> tuple[int, int, float, bool] | None:
    """回傳 (緯度位置, 經度位置, 格子中心到該點的公里數, 是否不是座標所在格)。

    先看座標所在格（中心最近的那一格）；`has_values` 在那一格是 False 時，在上下左右各
    `max_cells` 格內找有值、中心最近的格子。都沒有就回 None。
    """
    i0 = int(np.abs(lat_axis - lat).argmin())
    j0 = int(np.abs(lon_axis - lon).argmin())
    if has_values[i0, j0]:
        distance = haversine_km(lat, lon, float(lat_axis[i0]), float(lon_axis[j0]))
        return i0, j0, distance, False
    best: tuple[int, int, float, bool] | None = None
    for i in range(max(0, i0 - max_cells), min(lat_axis.size, i0 + max_cells + 1)):
        for j in range(max(0, j0 - max_cells), min(lon_axis.size, j0 + max_cells + 1)):
            if not has_values[i, j]:
                continue
            distance = haversine_km(lat, lon, float(lat_axis[i]), float(lon_axis[j]))
            if best is None or distance < best[2]:
                best = (i, j, distance, True)
    return best


def read_cube_cells(
    path: Path, points: dict[str, tuple[float, float]]
) -> dict[str, dict[str, Any]]:
    """從一個立方體取多個座標所在格的月序列。回傳 {地點: {"values": {月份索引: 值}, "detail": 取法}}。"""
    import netCDF4  # 只有這個函式要讀 netCDF；純函式的測試不必載入

    from trend_detective.grid_regions import read_cube_axes

    months, lat_axis, lon_axis, name, unit = read_cube_axes(path)
    lat_step = float(abs(lat_axis[-1] - lat_axis[0]) / (lat_axis.size - 1))
    lon_step = float(abs(lon_axis[-1] - lon_axis[0]) / (lon_axis.size - 1))
    found: dict[str, dict[str, Any]] = {}
    with netCDF4.Dataset(path) as dataset:
        variable = dataset.variables[name]
        variable.set_auto_mask(False)
        for location_id, (lat, lon) in points.items():
            i0 = int(np.abs(lat_axis - lat).argmin())
            j0 = int(np.abs(lon_axis - lon).argmin())
            lo_i, hi_i = max(0, i0 - 2), min(lat_axis.size, i0 + 3)
            lo_j, hi_j = max(0, j0 - 2), min(lon_axis.size, j0 + 3)
            block = np.asarray(variable[:, lo_i:hi_i, lo_j:hi_j], dtype=np.float64)
            has_values = np.isfinite(block).any(axis=0)
            cell = nearest_cell_with_values(
                lat_axis[lo_i:hi_i], lon_axis[lo_j:hi_j], has_values, lat, lon
            )
            if cell is None:
                continue
            i, j, distance, fallback = cell
            series = block[:, i, j]
            found[location_id] = {
                "values": {
                    cleaning.month_index(month.isoformat()): float(value)
                    for month, value in zip(months, series, strict=True)
                    if math.isfinite(value)
                },
                "detail": {
                    "cube": path.name,
                    "cube_variable": name,
                    "unit": unit,
                    "point": [lat, lon],
                    "cell_center": [
                        round(float(lat_axis[lo_i + i]), 4),
                        round(float(lon_axis[lo_j + j]), 4),
                    ],
                    "cell_size_deg": [round(lat_step, 4), round(lon_step, 4)],
                    "distance_km": round(distance, 2),
                    "containing_cell": not fallback,
                    "note": "nearest cell with values within 2 cells; the cell that "
                    "contains the point has no values"
                    if fallback
                    else "cell that contains the point",
                },
            }
    return found


# ---------------------------------------------------------------- 資料庫與匯出


def _column(stats_: dict[str, Any], *path: str) -> Any:
    value: Any = stats_
    for key in path:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def build(
    env_file: Path, *, rules_file: Path, raw_grid_dir: Path, analysis_dir: Path
) -> dict[str, Any]:
    """算全部配對，寫 `analysis.model_obs_pairs` 與 `model_vs_obs.json`。"""
    from psycopg.types.json import Jsonb

    from trend_detective import pg

    started = datetime.now(UTC)
    rules = load_rules(rules_file)
    params = params_from(rules)
    with pg.connect(env_file) as conn:
        series = {
            series_key(row[1], row[2], row[3]): {
                "series_id": row[0],
                "tier": row[4],
                "unit": row[5],
                "known_issues": row[6],
                "source_api": row[7],
                "grid": [row[8], row[9]] if row[8] is not None else None,
            }
            for row in conn.execute(
                "SELECT s.series_id, s.variable_id, s.location_id, s.aggregation, s.tier,"
                " s.unit, q.known_issues, s.source_api, s.grid_lat, s.grid_lon"
                " FROM meta.series s JOIN clean.series_summary q USING (series_id)"
            )
        }
        pairs = expand_pairs(rules, set(series))
        locations = {
            row[0]: {
                "name_en": row[1],
                "name_zh": row[2],
                "kind": row[3],
                "group": row[4],
                "lat": row[5],
                "lon": row[6],
                **{k: row[7][k] for k in ("region", "elevation_m") if k in row[7]},
            }
            for row in conn.execute(
                "SELECT id, name_en, name_zh, kind, location_group, lat, lon, attributes"
                " FROM meta.locations"
            )
        }
        variables = {
            row[0]: {
                "name_en": row[1],
                "unit": row[2],
                "product": row[3],
                "data_kind": row[4],
                "data_kind_note": row[5],
            }
            for row in conn.execute(
                "SELECT id, name_en, unit, product, data_kind, data_kind_note"
                " FROM meta.variables"
            )
        }
        issues = pg.read_known_issues(conn)

        def clean_values(key: str) -> dict[int, float]:
            return to_index_map(
                [
                    (month.isoformat(), value)
                    for month, value in conn.execute(
                        "SELECT month, value_clean FROM clean.observations"
                        " WHERE series_id = %s ORDER BY month",
                        (series[key]["series_id"],),
                    )
                ]
            )

        cache: dict[str, dict[int, float]] = {}
        cube_points: dict[str, dict[str, tuple[float, float]]] = {}
        for pair in pairs:
            if pair.model_source == SOURCE_CUBE and pair.cube_id:
                location = locations[pair.location_id]
                cube_points.setdefault(pair.cube_id, {})[pair.location_id] = (
                    location["lat"],
                    location["lon"],
                )
        cubes = {
            cube_id: read_cube_cells(raw_grid_dir / cube_id / f"{cube_id}.nc", points)
            for cube_id, points in cube_points.items()
        }
        results: list[dict[str, Any]] = []
        skipped: list[dict[str, str]] = []
        for pair in pairs:
            obs_key = series_key(
                pair.obs_variable_id, pair.location_id, pair.obs_aggregation
            )
            if obs_key not in cache:
                cache[obs_key] = clean_values(obs_key)
            model_series_id = None
            if pair.model_source == SOURCE_CUBE:
                cell = cubes.get(pair.cube_id or "", {}).get(pair.location_id)
                if cell is None:
                    skipped.append(
                        {"pair_id": pair.pair_id, "reason": "no cube cell with values"}
                    )
                    continue
                model_values = cell["values"]
                model_detail = cell["detail"]
                model_issues = [
                    issue.id
                    for issue in cleaning.issues_for(
                        pair.model_variable_id, issues, "point", pair.location_id
                    )
                    if issue.kind != cleaning.KIND_AUXILIARY
                ]
            else:
                model_key = series_key(
                    pair.model_variable_id,
                    pair.model_location_id,
                    pair.model_aggregation or "",
                )
                if model_key not in cache:
                    cache[model_key] = clean_values(model_key)
                model_values = cache[model_key]
                model_series_id = series[model_key]["series_id"]
                model_location = locations[pair.model_location_id]
                obs_location = locations[pair.location_id]
                model_detail = {
                    "series": model_key,
                    "source_api": series[model_key]["source_api"],
                    "grid": series[model_key]["grid"],
                }
                if (
                    pair.model_location_id != pair.location_id
                    and model_location["lat"] is not None
                    and obs_location["lat"] is not None
                ):
                    model_detail["distance_km"] = round(
                        haversine_km(
                            obs_location["lat"],
                            obs_location["lon"],
                            model_location["lat"],
                            model_location["lon"],
                        ),
                        2,
                    )
                model_issues = list(series[model_key]["known_issues"])
            computed = pair_statistics(model_values, cache[obs_key], params)
            known = sorted({*model_issues, *series[obs_key]["known_issues"]})
            results.append(
                {
                    "pair_id": pair.pair_id,
                    "group": pair.group,
                    "quantity": pair.quantity,
                    "location_id": pair.location_id,
                    "model": {
                        "variable_id": pair.model_variable_id,
                        "source": pair.model_source,
                        "location_id": pair.model_location_id,
                        "series_id": model_series_id,
                        "known_issues": model_issues,
                        "detail": model_detail,
                    },
                    "obs": {
                        "variable_id": pair.obs_variable_id,
                        "series": obs_key,
                        "series_id": series[obs_key]["series_id"],
                        "source_api": series[obs_key]["source_api"],
                        "grid": series[obs_key]["grid"],
                        "known_issues": list(series[obs_key]["known_issues"]),
                    },
                    "known_issues": known,
                    "monthly_in_export": pair.monthly,
                    **computed,
                }
            )
        used = {issue for item in results for issue in item["known_issues"]}
        known_issues = {
            issue.id: {
                key: value
                for key, value in asdict(issue).items()
                if key != "id" and value is not None
            }
            for issue in issues
            if issue.id in used
        }
        n_analyzed = sum(item["status"] == "analyzed" for item in results)
        by_group: dict[str, int] = {}
        for item in results:
            by_group[item["group"]] = by_group.get(item["group"], 0) + 1
        summary = {
            "n_pairs": len(results),
            "n_analyzed": n_analyzed,
            "n_insufficient": len(results) - n_analyzed,
            "n_pairs_by_group": by_group,
            "n_skipped": len(skipped),
        }
        run_parameters = {
            "rules_file": rules_file.as_posix(),
            "parameters": asdict(params),
            "raw_grid_dir": raw_grid_dir.as_posix(),
        }
        run_id = pg.record_run(
            conn, "model_obs_pairs", started, run_parameters, {"summary": summary}
        )
        conn.execute("TRUNCATE analysis.model_obs_pairs")
        rows = [
            (
                item["pair_id"],
                run_id,
                item["group"],
                item["quantity"],
                item["location_id"],
                item["model"]["variable_id"],
                item["model"]["source"],
                item["model"]["series_id"],
                Jsonb(item["model"]["detail"]),
                item["obs"]["variable_id"],
                item["obs"]["series_id"],
                params.window_start,
                params.window_end,
                item["status"],
                item["n_common_months"],
                item["first_common_month"],
                item["last_common_month"],
                item.get("correlation"),
                _column(item, "difference", "mean"),
                _column(item, "difference", "sd"),
                _column(item, "difference", "rmse"),
                _column(item, "model_trend", "slope_per_decade"),
                (_column(item, "model_trend", "ci_per_decade") or [None, None])[0],
                (_column(item, "model_trend", "ci_per_decade") or [None, None])[1],
                _column(item, "obs_trend", "slope_per_decade"),
                (_column(item, "obs_trend", "ci_per_decade") or [None, None])[0],
                (_column(item, "obs_trend", "ci_per_decade") or [None, None])[1],
                item.get("slope_difference"),
                _column(item, "difference", "trend", "slope_per_decade"),
                (_column(item, "difference", "trend", "ci_per_decade") or [None, None])[
                    0
                ],
                (_column(item, "difference", "trend", "ci_per_decade") or [None, None])[
                    1
                ],
                _column(item, "difference", "trend", "p"),
                _column(item, "difference", "trend", "significant"),
                _column(item, "difference", "largest_step"),
                _column(item, "difference", "largest_step_month"),
                item["known_issues"],
                Jsonb(
                    {
                        "model": item["model"],
                        "obs": item["obs"],
                    }
                ),
            )
            for item in results
        ]
        with conn.cursor() as cursor:
            cursor.executemany(
                pg._sql(
                    "INSERT INTO analysis.model_obs_pairs VALUES"
                    f" ({','.join(['%s'] * 37)})"
                ),
                rows,
            )
        conn.commit()
    # 匯出：世界城市只給統計量與逐年平均，控制檔案大小
    exported = []
    for item in results:
        entry = {k: v for k, v in item.items() if k not in ("monthly",)}
        monthly = item.get("monthly")
        if monthly is not None:
            entry["annual"] = annual_means(monthly)
            if item["monthly_in_export"]:
                entry["monthly"] = monthly
        for side in ("model", "obs"):
            entry[side] = {k: v for k, v in entry[side].items() if k != "series_id"}
        exported.append(entry)
    used_variables = {
        item[side]["variable_id"] for item in results for side in ("model", "obs")
    }
    used_locations = {
        location
        for item in results
        for location in (item["location_id"], item["model"]["location_id"])
    }
    header = {
        "schema_version": SCHEMA_VERSION,
        "input": {
            "rules": rules_file.as_posix(),
            "database": "clean.observations.value_clean (pg load, pg clean)",
            "grid_cubes": sorted(cube_points),
        },
        "parameters": asdict(params),
        "packages": {name: version(name) for name in ("numpy", "scipy")},
    }
    content = trends._round(
        {
            **header,
            "methods": {
                "common_period": "months inside the window in which both series "
                "have a usable value (value_clean); only those months are used",
                "anomaly": "each series minus its own mean of the same calendar "
                "month over the common months, so different baselines, absolute "
                "values versus anomalies, and degC versus K are comparable; both "
                "anomalies and their difference therefore average to zero",
                "trend": "least-squares slope of the anomalies on time over the "
                "common months, 95% confidence interval and p with the lag-1 "
                "autocorrelation correction (trends.ols_trend)",
                "difference": "model anomaly minus observation anomaly",
                "largest_step": "for every month m, the mean of the difference "
                "over the 6 months from m minus the mean over the 6 months "
                "before m (at least 4 months on each side); the month with the "
                "largest absolute value",
                "grid_cube_cell": "model value of the grid cell that contains the "
                "station, read from the global monthly cube; if that cell has no "
                "values, the nearest cell with values within 2 cells",
                "annual": "calendar-year means of the monthly anomalies and "
                "difference; null when fewer than 9 common months",
            },
            "note": "A difference between a model and an observation does not by "
            "itself say which one is right. Stations are points, model values "
            "are grid cells; see docs/data/model-vs-obs.md.",
            "summary": summary,
            "related_not_same_quantity": rules.get("related_not_same_quantity", []),
            "known_issues": known_issues,
            "variables": {key: variables[key] for key in sorted(used_variables)},
            "locations": {key: locations[key] for key in sorted(used_locations)},
            "skipped": skipped,
            "pairs": exported,
        }
    )
    trends._dump(analysis_dir / OUTPUT_NAME, content, compact=True)
    trends._dump(
        analysis_dir / OUTPUT_NAME.replace(".json", ".run.json"),
        {
            "command": "uv run python -m trend_detective.model_obs",
            "generated_at": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
            **header,
            "outputs": [OUTPUT_NAME],
            "summary": summary,
        },
    )
    return {"summary": summary, "results": results, "skipped": skipped}


def main(argv: list[str] | None = None) -> int:
    from trend_detective import pg

    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--env-file", type=Path, default=pg.ENV_FILE)
    parser.add_argument("--rules-file", type=Path, default=PAIRS_SEED)
    parser.add_argument("--raw-grid-dir", type=Path, default=RAW_DIR / "grid")
    parser.add_argument("--analysis-dir", type=Path, default=trends.ANALYSIS_DIR)
    args = parser.parse_args(argv)
    result = build(
        args.env_file,
        rules_file=args.rules_file,
        raw_grid_dir=args.raw_grid_dir,
        analysis_dir=args.analysis_dir,
    )
    print(json.dumps(result["summary"], ensure_ascii=False))
    for item in result["results"]:
        if item["status"] != "analyzed":
            print(f"  {item['pair_id']}: {item['status']} ({item['n_common_months']})")
            continue
        difference = item["difference"]
        print(
            f"  {item['pair_id']:<58} n={item['n_common_months']:>3}"
            f" r={item['correlation']:.3f}"
            f" model={item['model_trend']['slope_per_decade']:+.3f}"
            f" obs={item['obs_trend']['slope_per_decade']:+.3f}"
            f" diff={item['slope_difference']:+.3f}"
            f" step={difference['largest_step']:+.2f}@{difference['largest_step_month'][:7]}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
