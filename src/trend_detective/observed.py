"""觀測來源（#97）：GISTEMP、GHCNm、台灣 GHCNh 測站、SMAP 的宣告與序列，合併給資料庫與趨勢統計用。

各來源的抓取程式（`gistemp.py`、`ghcnm.py`、`ghcnh_taiwan.py`、`smap.py`）把月序列寫到
`data/observed/<來源>/`（不進 git，格式與快照相同：`catalog.json` 加 `series/*.json`），宣告在
`data/seed/sources/<來源>.json`（進 git）。這個模組只讀不寫那些目錄：

- `read_declarations`：來源宣告（變數、新地點、`source_api` 與說明）。
- `read_observed`：宣告加各來源目錄檔，合成 (變數, 地點, 序列檔)。變數與地點的定義以宣告為準，
  目錄檔只補宣告沒有的地點（例如已在核心 seed 的城市）。**不把這些變數寫進 `variables.json`**：
  `snapshot.py` 會把那裡的變數當核心來源重抓。
- `merged_catalog`：把各來源的目錄檔併成一份（`file` 加上來源目錄），給 `trends.analyze_snapshot`。

趨勢（方法與核心相同，`trends.py`；整批做一次 BH-FDR）：

    uv run python -m trend_detective.observed

寫到 `data/extended/analysis/observed/trends.json`（不進 git）；`pg analysis` 從那裡載入。
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from trend_detective import cleaning, trends
from trend_detective.extended import EXTENDED_DIR
from trend_detective.snapshot import SEED_DIR

OBSERVED_DIR = Path("data/observed")
SOURCES_DIR = SEED_DIR / "sources"
TIER = "observed"
ANALYSIS_SUBDIR = Path("analysis") / "observed"
# 宣告檔沒寫 `source_api` 時的對照（序列檔裡的 `source_api`）與 `meta.sources` 的說明
SOURCE_DESCRIPTIONS = {
    "gistemp": "NASA GISTEMP v4 gridded temperature anomaly analysis (2-degree cells, "
    "official global and hemispheric means)",
    "noaa_ghcnm": "NOAA GHCN-Monthly v4 station monthly mean temperature (QCF and QCU)",
    "smap": "NASA SMAP L3 radiometer soil moisture via Earthdata Cloud OPeNDAP, "
    "averaged to months",
}


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_declarations(sources_dir: Path = SOURCES_DIR) -> dict[str, dict[str, Any]]:
    """`data/seed/sources/*.json`，鍵是檔名（也是 `data/observed/` 底下的目錄名）。"""
    if not sources_dir.is_dir():
        return {}
    return {path.stem: _load(path) for path in sorted(sources_dir.glob("*.json"))}


def source_api(declaration: dict[str, Any]) -> str:
    return str(declaration.get("source_api") or declaration["source"])


def declared_variables(declaration: dict[str, Any]) -> list[dict[str, Any]]:
    """宣告裡的新變數。`reuse_core_variable` 的（台灣測站的 `station_temp`）沿用核心的定義，不回傳。"""
    api = source_api(declaration)
    found = []
    for variable in declaration.get("variables", []):
        if variable.get("reuse_core_variable"):
            continue
        merged = {
            "source": api,
            "is_nasa": declaration.get("is_nasa"),
            "doi": declaration.get("doi"),
            "data_kind_note": declaration.get("data_kind_note"),
            **variable,
        }
        citation = merged.get("citation") or declaration.get("citation")
        if isinstance(citation, list):
            citation = " ".join(citation)
        merged["citation"] = citation
        found.append(merged)
    return found


def declared_locations(declaration: dict[str, Any]) -> list[dict[str, Any]]:
    """宣告裡的新地點：`new_locations`（GISTEMP 的半球），或是物件陣列的 `locations`（台灣測站）。"""
    found = list(declaration.get("new_locations", []))
    locations = declaration.get("locations")
    if isinstance(locations, list):
        found += [loc for loc in locations if isinstance(loc, dict)]
    return found


def merged_catalog(
    observed_dir: Path, declarations: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """各來源的目錄檔併成一份；`file` 改成相對於 `observed_dir`。沒有目錄檔的來源略過。"""
    variables: dict[str, dict[str, Any]] = {}
    locations: dict[str, dict[str, Any]] = {}
    series: list[dict[str, Any]] = []
    generated: list[str] = []
    for name in declarations:
        path = observed_dir / name / "catalog.json"
        if not path.exists():
            continue
        catalog = _load(path)
        for variable in catalog.get("variables", []):
            variables.setdefault(variable["id"], variable)
        for location in catalog.get("locations", []):
            locations.setdefault(location["id"], location)
        for entry in catalog.get("series", []):
            series.append({**entry, "source": name, "file": f"{name}/{entry['file']}"})
        generated.append(catalog["snapshot"]["generated_at"])
    return {
        "variables": list(variables.values()),
        "locations": list(locations.values()),
        "series": series,
        "snapshot": {"generated_at": max(generated) if generated else None},
    }


def read_observed(
    observed_dir: Path, sources_dir: Path = SOURCES_DIR
) -> tuple[
    list[dict[str, Any]], list[dict[str, Any]], list[tuple[str, Path]], dict[str, str]
]:
    """回傳 (變數, 地點, [(tier, 序列檔路徑)], {source_api: 說明})。

    變數與新地點來自宣告（沒有序列的來源，例如 SMAP，變數仍會登記）；目錄檔裡宣告沒有的地點
    （核心或擴充 seed 已有的城市）也回傳，呼叫端以既有的為準。
    """
    declarations = read_declarations(sources_dir)
    variables: dict[str, dict[str, Any]] = {}
    locations: dict[str, dict[str, Any]] = {}
    sources: dict[str, str] = {}
    for declaration in declarations.values():
        api = source_api(declaration)
        if api in SOURCE_DESCRIPTIONS:
            sources[api] = SOURCE_DESCRIPTIONS[api]
        for variable in declared_variables(declaration):
            variables.setdefault(variable["id"], {**variable, "tier": TIER})
        for location in declared_locations(declaration):
            locations.setdefault(location["id"], {**location, "tier": TIER})
    catalog = merged_catalog(observed_dir, declarations)
    for location in catalog["locations"]:
        locations.setdefault(location["id"], {**location, "tier": TIER})
    files = sorted(
        (
            f"{e['variable_id']}__{e['location_id']}__{e['aggregation']}",
            observed_dir / e["file"],
        )
        for e in catalog["series"]
    )
    return (
        list(variables.values()),
        list(locations.values()),
        [(TIER, path) for _, path in files],
        sources,
    )


def analyze(
    observed_dir: Path, sources_dir: Path, cleaning_seed: Path
) -> dict[str, Any]:
    """觀測序列的趨勢：和核心同一個函式、同一組參數，整批做一次 BH-FDR；不寫月距平。"""
    catalog = merged_catalog(observed_dir, read_declarations(sources_dir))
    result, _ = trends.analyze_snapshot(
        observed_dir,
        trends.TrendParams(),
        with_anomalies=False,
        cleaning_seed=cleaning_seed,
        catalog=catalog,
    )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--observed-dir", type=Path, default=OBSERVED_DIR)
    parser.add_argument("--sources-dir", type=Path, default=SOURCES_DIR)
    parser.add_argument("--cleaning-seed", type=Path, default=cleaning.CLEANING_SEED)
    parser.add_argument(
        "--analysis-dir", type=Path, default=EXTENDED_DIR / ANALYSIS_SUBDIR
    )
    args = parser.parse_args(argv)
    result = analyze(args.observed_dir, args.sources_dir, args.cleaning_seed)
    if not result["series"]:
        print(f"{args.observed_dir} 沒有任何觀測序列。", file=sys.stderr)
        return 1
    trends.write_outputs(
        args.analysis_dir,
        result,
        None,
        generated_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        command="uv run python -m trend_detective.observed",
    )
    summary = result["summary"]
    print(f"{len(result['series'])} 條觀測序列 → {args.analysis_dir / 'trends.json'}")
    print(json.dumps(summary, ensure_ascii=False)[:600])
    return 0


if __name__ == "__main__":
    sys.exit(main())
