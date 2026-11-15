"""世界子集（#107）：把擴充資料裡「核心圖層變數 × 世界城市與全球平均」的序列匯出成發佈用的快照。

`data/extended/` 不進 git，公開網站讀不到；這個指令照 `data/seed/world_subset.json` 的對應表，
把其中一小部分原樣複製到 `data/snapshot/world/`（格式與核心快照相同：`catalog.json` 加
`series/*.json`），再用同一套 `trends.py` 與清洗規則算出 `data/analysis/world/` 的趨勢與距平。

- 不連網、不重抓：來源只有磁碟上的 `data/extended/series/`。
- 每條序列匯出前先核對單位、Giovanni 資料 id（或格點產品）與版本和對應表一致，並和核心快照
  同一變數的台灣點位序列相同；對不上就報錯，不寫任何檔。
- 數值不四捨五入、`points` 原樣保留；`request` 多兩個欄位：`exported_from = "extended"` 與
  `extended_variable_id`。`retrieved_at` 保留原序列的（清洗用它判斷未滿的月份）。
- 冪等：內容沒變的檔不動。
- FDR：世界子集自成一個家族（這次執行的全部序列，各檢定分開），與核心快照、擴充資料的 FDR
  分開做，所以同一條序列的 `p_fdr` 與 `data/extended/analysis/trends.json` 裡的不同（那邊是
  同一種聚合方式的幾千條一起校正）；`p`、斜率與信賴區間相同。
"""

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from trend_detective import cleaning, trends
from trend_detective.series import Series, write_catalog, write_series

SEED_DIR = Path("data/seed")
MAPPING_FILE = SEED_DIR / "world_subset.json"
EXTENDED_DIR = Path("data/extended")
CORE_DIR = Path("data/snapshot")
WORLD_DIR = CORE_DIR / "world"
ANALYSIS_DIR = Path("data/analysis/world")
EXPORT_MARK = "extended"
COMMAND = "uv run python -m trend_detective.world_export"
FDR_NOTE = (
    "The world subset is its own Benjamini-Hochberg family: p_fdr is adjusted across "
    "the series of this file only, separately for each test. It is separate from the "
    "core snapshot (data/analysis/trends.json) and from data/extended/analysis, so the "
    "same series has a different p_fdr there; p, slopes and intervals are the same."
)


class MappingError(ValueError):
    """擴充序列與對應表或核心序列對不上。"""


def load_mapping(path: Path = MAPPING_FILE) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def exported_variables(mapping: dict[str, Any]) -> list[dict[str, Any]]:
    return [row for row in mapping["variables"] if row.get("extended_id")]


def missing_variables(mapping: dict[str, Any]) -> list[str]:
    return [
        row["core_id"] for row in mapping["variables"] if not row.get("extended_id")
    ]


def subset_locations(
    mapping: dict[str, Any], locations: list[dict[str, Any]]
) -> list[tuple[dict[str, Any], str]]:
    """對應表列出的地點群組裡的地點，各自要匯出的聚合方式；順序照 seed。"""
    aggregation = {g["group"]: g["aggregation"] for g in mapping["location_groups"]}
    return [
        (location, aggregation[location["group"]])
        for location in locations
        if location.get("group") in aggregation
    ]


def source_mismatches(row: dict[str, Any], series: dict[str, Any]) -> list[str]:
    """這條序列與對應表不一致的地方；空清單表示同源。"""
    problems = []
    if series.get("unit") != row["unit"]:
        problems.append(f"unit {series.get('unit')!r} != {row['unit']!r}")
    if series.get("product_version") != row["product_version"]:
        problems.append(
            f"product_version {series.get('product_version')!r} != "
            f"{row['product_version']!r}"
        )
    request = series.get("request", {})
    if series.get("source_api") == "giovanni":
        if request.get("data") != row["giovanni_data"]:
            problems.append(
                f"request.data {request.get('data')!r} != {row['giovanni_data']!r}"
            )
    elif series.get("source_api") == "grid":
        if request.get("product") != row["product"]:
            problems.append(
                f"request.product {request.get('product')!r} != {row['product']!r}"
            )
    else:
        problems.append(f"unexpected source_api {series.get('source_api')!r}")
    return problems


def export_series(row: dict[str, Any], series: dict[str, Any]) -> Series:
    """擴充序列 → 世界子集的序列：變數 id 換成核心的，其餘原樣，`request` 加註來源。"""
    problems = source_mismatches(row, series)
    if problems:
        raise MappingError(
            f"{series.get('variable_id')}__{series.get('location_id')}: "
            + "; ".join(problems)
        )
    return Series(
        variable_id=row["core_id"],
        location_id=series["location_id"],
        aggregation=series["aggregation"],
        unit=series["unit"],
        source_api=series["source_api"],
        request={
            **series["request"],
            "exported_from": EXPORT_MARK,
            "extended_variable_id": row["extended_id"],
        },
        retrieved_at=series["retrieved_at"],
        product_version=series["product_version"],
        grid=series.get("grid"),
        points=series["points"],
    )


def check_against_core(mapping: dict[str, Any], core_dir: Path) -> list[str]:
    """核心快照裡同一變數的點位序列也要符合對應表；回傳不一致的說明。"""
    problems = []
    for row in exported_variables(mapping):
        paths = sorted((core_dir / "series").glob(f"{row['core_id']}__*__point.json"))
        if not paths:
            problems.append(f"{row['core_id']}: no core point series to compare with")
        for path in paths:
            series = json.loads(path.read_text(encoding="utf-8"))
            problems += [f"{path.name}: {p}" for p in source_mismatches(row, series)]
    return problems


def collect(
    mapping: dict[str, Any],
    locations: list[dict[str, Any]],
    extended_dir: Path,
) -> tuple[list[Series], list[tuple[str, str, str]]]:
    """回傳 (要匯出的序列, 擴充資料裡沒有的 (變數, 地點, 聚合方式))。"""
    found: list[Series] = []
    absent: list[tuple[str, str, str]] = []
    for row in exported_variables(mapping):
        for location, aggregation in subset_locations(mapping, locations):
            name = f"{row['extended_id']}__{location['id']}__{aggregation}.json"
            path = extended_dir / "series" / name
            if not path.exists():
                absent.append((row["core_id"], location["id"], aggregation))
                continue
            found.append(
                export_series(row, json.loads(path.read_text(encoding="utf-8")))
            )
    return found, absent


def describe_variables(
    mapping: dict[str, Any], variables: list[dict[str, Any]], series: list[Series]
) -> list[dict[str, Any]]:
    """目錄檔的變數條目：seed 的說明加上這個子集自己的單位與有效期間。"""
    wanted = {row["core_id"] for row in exported_variables(mapping)}
    described = []
    for variable in variables:
        if variable["id"] not in wanted:
            continue
        own = [s for s in series if s.variable_id == variable["id"]]
        months = [p["month"] for s in own for p in s.points if p["value"] is not None]
        described.append(
            {
                **variable,
                "unit": own[0].unit if own else None,
                "valid_from": min(months) if months else None,
                "valid_to": max(months) if months else None,
            }
        )
    return described


def write_subset(
    out_dir: Path,
    mapping: dict[str, Any],
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    series: list[Series],
    *,
    now: str,
) -> list[Path]:
    """寫出序列檔與目錄檔；不在這次清單裡的舊序列檔會刪掉（子集只由對應表決定）。"""
    keep = {Path(s.file).name for s in series}
    series_dir = out_dir / "series"
    if series_dir.exists():
        for stale in series_dir.glob("*.json"):
            if stale.name not in keep:
                stale.unlink()
    written = [write_series(out_dir, s) for s in series]
    used = {s.location_id for s in series}
    slim = [
        {k: v for k, v in location.items() if k != "geojson"}
        for location in locations
        if location["id"] in used
    ]
    catalog_path = out_dir / "catalog.json"
    previous = (
        json.loads(catalog_path.read_text(encoding="utf-8"))
        if catalog_path.exists()
        else None
    )
    write_catalog(
        out_dir,
        describe_variables(mapping, variables, series),
        slim,
        series,
        generated_at=now,
        stamp=True,
    )
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["snapshot"] = {
        **catalog["snapshot"],
        "exported_from": EXPORT_MARK,
        "mapping": MAPPING_FILE.as_posix(),
        "not_available": missing_variables(mapping),
    }
    if previous is not None:
        # 內容沒變就沿用上次的 generated_at，重跑的 git diff 才會是空的
        stamped = {**catalog["snapshot"], "generated_at": None}
        if {**previous, "snapshot": None} == {**catalog, "snapshot": None} and {
            **previous.get("snapshot", {}),
            "generated_at": None,
        } == stamped:
            catalog = previous
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return [*written, catalog_path]


def analyze_subset(
    world_dir: Path, analysis_dir: Path, *, cleaning_seed: Path, now: str
) -> dict[str, Any]:
    """用核心快照同一套參數與清洗規則算趨勢與距平；FDR 的範圍是這個子集。"""
    result, anomalies = trends.analyze_snapshot(
        world_dir, trends.TrendParams(), cleaning_seed=cleaning_seed
    )
    result = {
        **{k: v for k, v in result.items() if k != "series"},
        "fdr_family": {
            "scope": "world_subset",
            "n_series": len(result["series"]),
            "note_en": FDR_NOTE,
        },
        "series": result["series"],
    }
    # 內容沒變就不動檔（執行紀錄的 generated_at 也不動），重跑的 git diff 才會是空的
    path = analysis_dir / "trends.json"
    same = json.loads(json.dumps(result, allow_nan=False))
    if path.exists() and json.loads(path.read_text(encoding="utf-8")) == same:
        return result
    trends.write_outputs(
        analysis_dir, result, anomalies, generated_at=now, command=COMMAND
    )
    return result


def month_table(series: list[Series]) -> list[dict[str, Any]]:
    """每條序列的起訖月與有值月數（交付時核對用）。"""
    rows = []
    for item in series:
        months = [p["month"] for p in item.points if p["value"] is not None]
        rows.append(
            {
                "variable_id": item.variable_id,
                "location_id": item.location_id,
                "first_month": min(months)[:7] if months else None,
                "last_month": max(months)[:7] if months else None,
                "n_valid": len(months),
            }
        )
    return rows


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--extended-dir", type=Path, default=EXTENDED_DIR)
    parser.add_argument("--core-dir", type=Path, default=CORE_DIR)
    parser.add_argument("--out-dir", type=Path, default=WORLD_DIR)
    parser.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    parser.add_argument("--seed-dir", type=Path, default=SEED_DIR)
    parser.add_argument("--mapping", type=Path, default=MAPPING_FILE)
    parser.add_argument("--cleaning-seed", type=Path, default=cleaning.CLEANING_SEED)
    parser.add_argument("--no-trends", action="store_true", help="只匯出序列，不算趨勢")
    parser.add_argument("--table", action="store_true", help="印出每條序列的起訖月")
    args = parser.parse_args(argv)

    mapping = load_mapping(args.mapping)
    variables = json.loads(
        (args.seed_dir / "variables.json").read_text(encoding="utf-8")
    )
    locations = json.loads(
        (args.seed_dir / "locations.world.json").read_text(encoding="utf-8")
    )
    problems = check_against_core(mapping, args.core_dir)
    if problems:
        print("對應表與核心快照不一致，沒有寫任何檔：")
        for problem in problems:
            print(f"  {problem}")
        return 1
    if not (args.extended_dir / "series").is_dir():
        print(
            f"找不到 {args.extended_dir}/series；擴充資料不進 git，要在有它的 checkout 跑"
        )
        return 1
    try:
        series, absent = collect(mapping, locations, args.extended_dir)
    except MappingError as error:
        print(f"擴充序列與對應表不一致，沒有寫任何檔：{error}")
        return 1
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    paths = write_subset(args.out_dir, mapping, variables, locations, series, now=now)
    size = sum(path.stat().st_size for path in paths)
    print(
        f"世界子集：{len(series)} 條序列、{len(paths)} 個檔、{size / 1e6:.2f} MB → "
        f"{args.out_dir}"
    )
    for variable_id, location_id, aggregation in absent:
        print(f"  擴充資料裡沒有：{variable_id}__{location_id}__{aggregation}")
    print(f"  世界地點沒有的圖層變數：{'、'.join(missing_variables(mapping))}")
    if args.table:
        for row in month_table(series):
            print(
                f"  {row['variable_id']:16} {row['location_id']:12} "
                f"{row['first_month']} {row['last_month']} {row['n_valid']}"
            )
    if not args.no_trends:
        result = analyze_subset(
            args.out_dir, args.analysis_dir, cleaning_seed=args.cleaning_seed, now=now
        )
        summary = result["summary"]
        ols = summary["significant_by_test"]["ols"]
        print(
            f"趨勢（自成一個 FDR 家族，{summary['n_series']} 條）：有分析 "
            f"{summary['n_analyzed']} 條、資料不足 {summary['n_insufficient']} 條；"
            f"ols p < 0.05 有 {ols['significant']} 條、FDR 校正後 "
            f"{ols['significant_fdr']} 條 → {args.analysis_dir}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
