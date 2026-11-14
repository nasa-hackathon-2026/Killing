"""由既有的立方體重產前端衍生檔（含逐格點的趨勢地圖，#68），並抽查趨勢結果。

    uv run python -m trend_detective.grid_derive

完全不連網、不需要 token：讀 `data/raw/grid/<id>/<id>.nc`，逐月降到衍生檔的網格，
再呼叫與 `grid_fetch` 相同的 `write_derived` 寫出 `data/grid/<id>/`。只處理 seed 裡有
`frontend` 設定的變數。立方體沒變時重跑，衍生檔逐位元組相同。

抽查（結果印出並寫進 `--report`，預設 `data/extended/analysis/grid_trends.report.json`）：

- 每個變數「格點斜率的面積加權平均」對照「全球平均序列（`<id>__global__area_mean_grid`）
  的斜率」，後者讀 `--series-trends`（擴充序列的 `trends.json`）。兩者不必相等：序列是
  「先對空間平均、再算距平與斜率」，每個月用當月有值的格子、權重 cos(緯度)、原始解析度；
  格點平均是「每格先算斜率、再對空間平均」，只含有分析的格子（月數不足的格子不算）。
  各格的有值月份相同時兩者在數學上相等，差異來自各月有值範圍不同與被排除的格子。
- 每個變數挑 3 個有分析的網格，逐條用 `trends.analyze_points` 算，比對斜率與 p 值。
"""

import argparse
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np

from trend_detective.extended import EXTENDED_DIR
from trend_detective.grid import EPOCH, META_FILE, GridError, regrid
from trend_detective.grid_fetch import (
    OUT_DIR,
    RAW_DIR,
    Built,
    GridProduct,
    load_products,
    select_products,
    write_derived,
)
from trend_detective.grid_trends import (
    ANALYZED,
    cell_points,
    cell_trends,
    month_indices,
)
from trend_detective.trends import TrendParams, analyze_points

SEED_FILES = (Path("data/seed/grids.json"), Path("data/seed/grids.extended.json"))
REPORT_FILE = EXTENDED_DIR / "analysis" / "grid_trends.report.json"
SERIES_TRENDS = EXTENDED_DIR / "analysis" / "trends.json"
N_SPOT_CELLS = 3


def read_coarse(product: GridProduct, cube_path: Path) -> Built:
    """逐月讀立方體並降到衍生檔的網格；一次只有一個月的原始解析度資料在記憶體裡。"""
    with netCDF4.Dataset(cube_path) as dataset:
        attrs = {name: str(dataset.getncattr(name)) for name in dataset.ncattrs()}
        variable = dataset.variables[attrs["variable"]]
        if variable.dimensions != ("time", "lat", "lon"):
            raise GridError(f"{cube_path.name} 的維度是 {variable.dimensions}")
        variable.set_auto_mask(False)
        months = [
            EPOCH + timedelta(days=int(days)) for days in dataset.variables["time"][:]
        ]
        lat = np.asarray(dataset.variables["lat"][:], dtype=np.float64)
        lon = np.asarray(dataset.variables["lon"][:], dtype=np.float64)
        unit = str(getattr(variable, "units", ""))
        coarse = []
        grid = None
        for i in range(len(months)):
            layer = np.asarray(variable[i], dtype=np.float32)
            small, grid = regrid(
                layer,
                lat,
                lon,
                lat_step=product.lat_step,
                lon_factor=product.lon_factor,
            )
            coarse.append(small)
    return Built(
        path=cube_path,
        months=months,
        lat=lat,
        lon=lon,
        unit=unit or product.unit,
        attrs=attrs,
        latest_mean=float("nan"),
        coarse=np.stack(coarse),
        grid=grid,
    )


def spot_check_cells(
    built: Built, params: TrendParams, n_cells: int = N_SPOT_CELLS
) -> list[dict[str, Any]]:
    """挑幾個有分析的網格（依位置等距取），逐條用 `trends.py` 算，與向量化結果並列。"""
    assert built.coarse is not None
    trend = cell_trends(month_indices(built.months), built.coarse, params)
    rows, cols = np.nonzero(trend.status == ANALYZED)
    if rows.size == 0:
        return []
    picks = np.linspace(0, rows.size - 1, n_cells + 2).astype(int)[1:-1]
    checks = []
    for k in picks:
        i, j = int(rows[k]), int(cols[k])
        single = analyze_points(
            cell_points(built.months, built.coarse[:, i, j]), params
        )
        slope, p = float(trend.slope_per_decade[i, j]), float(trend.p[i, j])
        checks.append(
            {
                "cell": [i, j],
                "n_valid": int(trend.n_valid[i, j]),
                "vectorized": {"slope_per_decade": slope, "p": p},
                "trends_py": {
                    "status": single["status"],
                    "slope_per_decade": single["ols"]["slope_per_decade"],
                    "p": single["ols"]["p"],
                },
                "abs_difference": {
                    "slope_per_decade": abs(slope - single["ols"]["slope_per_decade"]),
                    "p": abs(p - single["ols"]["p"]),
                },
            }
        )
    return checks


def derive(
    product: GridProduct, raw_dir: Path, out_dir: Path, params: TrendParams
) -> dict[str, Any]:
    """一個變數：重產衍生檔，回傳 `trend` 區塊、檔案大小與 3 個網格的抽查。"""
    built = read_coarse(product, raw_dir / product.id / f"{product.id}.nc")
    written = write_derived(product, built, out_dir / product.id, params)
    meta = json.loads((out_dir / product.id / META_FILE).read_text(encoding="utf-8"))
    return {
        "id": product.id,
        "unit": built.unit,
        "trend": meta["trend"],
        "files": {path.name: path.stat().st_size for path in written},
        "cell_checks": spot_check_cells(built, params),
    }


def _derive_job(job: tuple[GridProduct, Path, Path, TrendParams]) -> dict[str, Any]:
    return derive(*job)


def compare_with_series(
    result: dict[str, Any], series_trends: dict[str, Any] | None
) -> dict[str, Any]:
    """格點斜率的面積加權平均，對照全球平均序列的斜率（沒有那條序列就只列格點的）。"""
    key = f"{result['id']}__global__area_mean_grid"
    grid_mean = result["trend"]["area_weighted_mean_slope_per_decade"]
    series = ((series_trends or {}).get("series") or {}).get(key)
    comparison: dict[str, Any] = {
        "series_key": key,
        "grid_area_weighted_mean_slope_per_decade": grid_mean,
        "global_mean_series": None,
    }
    if series and series["status"] == "analyzed":
        slope = series["ols"]["slope_per_decade"]
        comparison["global_mean_series"] = {
            "slope_per_decade": slope,
            "ci_per_decade": series["ols"]["ci_per_decade"],
            "p": series["ols"]["p"],
            "first_month": series["data"]["first_month"],
            "last_month": series["data"]["last_month"],
        }
        comparison["same_sign"] = bool(grid_mean * slope > 0)
        comparison["ratio_grid_to_series"] = grid_mean / slope if slope else None
    return comparison


def main(argv: list[str] | None = None) -> int:
    defaults = TrendParams()
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument(
        "--product", action="append", help="只跑這些 id（可重複、可用 *）"
    )
    parser.add_argument("--seed-file", type=Path, action="append")
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--series-trends", type=Path, default=SERIES_TRENDS)
    parser.add_argument("--report", type=Path, default=REPORT_FILE)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument(
        "--min-valid-months", type=int, default=defaults.min_valid_months
    )
    parser.add_argument(
        "--max-missing-fraction", type=float, default=defaults.max_missing_fraction
    )
    parser.add_argument("--alpha", type=float, default=defaults.alpha)
    args = parser.parse_args(argv)
    params = TrendParams(
        min_valid_months=args.min_valid_months,
        max_missing_fraction=args.max_missing_fraction,
        alpha=args.alpha,
    )
    seed_files = args.seed_file or list(SEED_FILES)
    products = [
        product
        for product in select_products(
            [product for seed in seed_files for product in load_products(seed)],
            args.product,
        )
        if product.derive
    ]
    missing = [
        product.id
        for product in products
        if not (args.raw_dir / product.id / f"{product.id}.nc").exists()
    ]
    if not products or missing:
        print(
            f"沒有可處理的變數，或缺立方體：{missing}（{args.raw_dir}）",
            file=sys.stderr,
        )
        return 1
    jobs = [(product, args.raw_dir, args.out_dir, params) for product in products]
    if args.workers > 1:
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            results = list(pool.map(_derive_job, jobs))
    else:
        results = [_derive_job(job) for job in jobs]

    series_trends = (
        json.loads(args.series_trends.read_text(encoding="utf-8"))
        if args.series_trends.exists()
        else None
    )
    for result in results:
        result["global_mean_check"] = compare_with_series(result, series_trends)
        trend, check = result["trend"], result["global_mean_check"]
        fdr, raw = trend["significant"]["fdr"], trend["significant"]["uncorrected"]
        series = check["global_mean_series"]
        worst = max(
            (c["abs_difference"]["slope_per_decade"] for c in result["cell_checks"]),
            default=float("nan"),
        )
        print(
            f"{result['id']}（{trend['period']['first_month']} 至 "
            f"{trend['period']['last_month']}，{result['unit']} per decade）："
            f"有分析 {trend['cells']['n_analyzed']}/{trend['cells']['n_total']} 格；"
            f"校正前顯著 面積 {raw['area_fraction']:.1%}（格點 {raw['cell_fraction']:.1%}），"
            f"FDR 後 面積 {fdr['area_fraction']:.1%}（格點 {fdr['cell_fraction']:.1%}）；"
            f"格點斜率面積加權平均 {check['grid_area_weighted_mean_slope_per_decade']:.6g}，"
            f"全球平均序列 {series['slope_per_decade'] if series else '（沒有）'}；"
            f"{len(result['cell_checks'])} 格逐條比對的斜率最大差 {worst:.2e}"
        )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps(
            {
                "command": "uv run python -m trend_detective.grid_derive",
                "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "parameters": asdict(params),
                "series_trends": args.series_trends.as_posix()
                if series_trends
                else None,
                "variables": results,
            },
            ensure_ascii=False,
            indent=1,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"已寫出 {args.out_dir}/<id>/ 與 {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
