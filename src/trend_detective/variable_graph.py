"""變數關聯圖（#111，探索性）：去趨勢、去季節月距平的兩兩相關，自相關修正加 BH-FDR。

    uv run python -m trend_detective.variable_graph            # 會連資料庫跑 pgRouting
    uv run python -m trend_detective.variable_graph --no-db    # 不連資料庫，只算 union-find

邊是相關，不是因果，也不代表物理上有關。

輸入：`data/analysis/anomalies.json`（台灣核心序列的月距平）、`trends.json`（資料不足的序列
與已知問題）、`data/analysis/world/anomalies.json`（世界城市）、`data/snapshot/catalog.json`
（變數順序與英文名）、`data/seed/variable_taxonomy.json`、`data/seed/data_kinds.json`。
輸出 `variable_graph.json` 與 `variable_graph.run.json`。

做法：

1. 台灣兩張表：點位表（5 個點位）與區域表（4 個區域；`taiwan` 的 bbox 與其他區域重疊，
   不用，和 `mining.py` 相同）。每條序列的月距平（已去月氣候值）再減掉自己的線性趨勢。
   不補值：每一對只用兩邊都有值的月份。
2. 每一對變數、每個時間設定（同月；落後一個月，兩個方向各一次）：各地點先各自算相關係數與
   有效樣本數（`mining_stats`：兩條序列各自的 lag-1 自相關修正）；表內合併的相關係數是把
   各地點標準化後的值接在一起算。合併檢定用的有效樣本數取**各地點有效樣本數的中位數**——
   同一張表的地點彼此相鄰、同一個月的天氣相同，不當成獨立樣本相加。
3. 同量變數的配對（`same_quantity_groups`，例如兩套 NDVI、各種氣溫產品）不檢定，列在
   `excluded_pairs`。
4. 同一張表全部檢定（三種時間設定一起）做 BH-FDR；q < `alpha` 的是圖上的邊，權重是 r（保留
   正負號）。全部檢定過的配對都列在 `edges`，`significant` 標出是否顯著。
5. 連通分量與度數：只用顯著的邊。Python 的 union-find 算一次；連資料庫時把邊寫進
   `analysis.correlation_nodes`／`analysis.correlation_edges`，用 `pgr_connectedComponents`
   再算一次並逐節點核對（`pgrouting`）。
6. 世界城市：12 個城市 × 10 個變數，每個城市各自算每一對的相關與顯著性（全部城市、全部
   配對、全部時間設定一起做 BH-FDR），再彙總每一對在幾個城市顯著、正負號是否一致。

參數在跑之前定好（`GraphParams`），寫進結果檔；沒有其他嘗試。資料沒變時重跑，結果檔逐位元組
相同（pgRouting 的核對只寫是否相同與個數）。
"""

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from itertools import combinations
from pathlib import Path
from typing import Any

import numpy as np

from trend_detective import cleaning, taxonomy
from trend_detective.mining import MiningParams
from trend_detective.mining_stats import (
    align,
    components,
    correlation_p,
    correlation_test,
    detrend,
    standardize,
)
from trend_detective.trends import (
    ANALYSIS_DIR,
    SNAPSHOT_DIR,
    _dump,
    _round,
    benjamini_hochberg,
)

SCHEMA_VERSION = 1
PACKAGES = ("numpy", "scipy")
MIGRATION = Path("db/migrations/023_mining_plus.sql")
NOTE = (
    "Edges are correlations of detrended, deseasonalised monthly anomalies; they do "
    "not show cause and effect."
)
SIGNIFICANCE_NOTE = (
    "p values use an effective sample size corrected for the lag-1 autocorrelation "
    "of both series; this is an approximation. Within a table the locations are "
    "neighbours, so the pooled test uses the median effective sample size of the "
    "locations, not their sum. q values are Benjamini-Hochberg over all tests of "
    "the same table."
)
Series = tuple[np.ndarray, np.ndarray]


@dataclass(frozen=True)
class GraphParams:
    tables: tuple[tuple[str, str], ...] = (("point", "point"), ("region", "area_mean"))
    exclude_locations: tuple[str, ...] = ("taiwan",)
    lags: tuple[int, ...] = (0, 1)
    alpha: float = 0.05
    min_common_months: int = 120
    same_quantity_groups: tuple[tuple[str, ...], ...] = (
        MiningParams().same_quantity_groups
    )
    world_groups: tuple[str, ...] = ("world_city",)


def same_quantity(a: str, b: str, params: GraphParams) -> bool:
    return any(a in group and b in group for group in params.same_quantity_groups)


def load_series(
    anomalies: dict[str, Any], trends: dict[str, Any], aggregation: str
) -> dict[tuple[str, str], Series]:
    """(變數, 地點) → (月序, 去趨勢距平)；趨勢統計標為資料不足的序列不放。"""
    out = {}
    for key, entry in anomalies["series"].items():
        if entry["aggregation"] != aggregation:
            continue
        if trends["series"].get(key, {}).get("status") != "analyzed":
            continue
        first = cleaning.month_index(entry["first_month"])
        values = np.array(
            [np.nan if v is None else v for v in entry["values"]], dtype=float
        )
        index = np.arange(first, first + values.size, dtype=np.int64)
        out[(entry["variable_id"], entry["location_id"])] = (
            index,
            detrend(index, values),
        )
    return out


def pair_tests(
    series: dict[tuple[str, str], Series],
    locations: list[str],
    a: str,
    b: str,
    lag: int,
    params: GraphParams,
) -> dict[str, Any] | None:
    """一對變數、一種時間設定：各地點的結果與表內合併的結果。`lag = 1` 是 a 領先 b 一個月。"""
    per_location = []
    pooled_x, pooled_y = [], []
    for location in locations:
        if (a, location) not in series or (b, location) not in series:
            continue
        index, x, y = align(*series[(a, location)], *series[(b, location)], lag=lag)
        if index.size < params.min_common_months:
            continue
        test = correlation_test(index, x, y)
        if test["r"] is None:
            continue
        per_location.append({"location": location, **test})
        pooled_x.append(standardize(x))
        pooled_y.append(standardize(y))
    if not per_location:
        return None
    r = float(np.corrcoef(np.concatenate(pooled_x), np.concatenate(pooled_y))[0, 1])
    n_eff = float(np.median([item["n_eff"] for item in per_location]))
    rs = [item["r"] for item in per_location]
    return {
        "source": a,
        "target": b,
        "lag": lag,
        "r": r,
        "n_eff": n_eff,
        "n_months_median": int(np.median([item["n"] for item in per_location])),
        "n_locations": len(per_location),
        "r_min": float(min(rs)),
        "r_max": float(max(rs)),
        "same_sign_in_all_locations": all(v > 0 for v in rs) or all(v < 0 for v in rs),
        "p": correlation_p(r, n_eff),
    }


def table_graph(
    series: dict[tuple[str, str], Series],
    order: list[str],
    issues: dict[str, list[str]],
    params: GraphParams,
) -> dict[str, Any]:
    locations = sorted(
        {loc for _, loc in series if loc not in params.exclude_locations}
    )
    present = {v for v, loc in series if loc in locations}
    variables = [v for v in order if v in present]
    edges, excluded = [], []
    for a, b in combinations(variables, 2):
        if same_quantity(a, b, params):
            excluded.append({"source": a, "target": b, "reason": "same_quantity"})
            continue
        for lag in params.lags:
            for source, target in ((a, b), (b, a)) if lag else ((a, b),):
                test = pair_tests(series, locations, source, target, lag, params)
                if test is not None:
                    edges.append(test)
    for edge, q in zip(
        edges, benjamini_hochberg([edge["p"] for edge in edges]), strict=True
    ):
        edge["q"] = q
        edge["significant"] = q < params.alpha
        edge["known_issues"] = bool(issues.get(edge["source"])) or bool(
            issues.get(edge["target"])
        )
    for number, edge in enumerate(edges, start=1):
        edge["edge_id"] = number
    node_id = {variable: number for number, variable in enumerate(variables, start=1)}
    significant = [edge for edge in edges if edge["significant"]]
    found = components(
        list(node_id.values()),
        [(node_id[e["source"]], node_id[e["target"]]) for e in significant],
    )
    nodes = [
        {
            "node_id": node_id[variable],
            "variable_id": variable,
            "component": found[node_id[variable]],
            "degree": len(
                {
                    e["target"] if e["source"] == variable else e["source"]
                    for e in significant
                    if variable in (e["source"], e["target"])
                }
            ),
            "n_significant_edges": sum(
                1 for e in significant if variable in (e["source"], e["target"])
            ),
        }
        for variable in variables
    ]
    return {
        "locations": locations,
        "n_tests": len(edges),
        "n_significant": len(significant),
        "n_significant_by_lag": {
            str(lag): sum(1 for e in significant if e["lag"] == lag)
            for lag in params.lags
        },
        "n_components": len({node["component"] for node in nodes}),
        "nodes": nodes,
        "edges": edges,
        "excluded_pairs": excluded,
    }


def world_summary(
    anomalies: dict[str, Any],
    trends: dict[str, Any],
    order: list[str],
    cities: list[str],
    params: GraphParams,
) -> dict[str, Any]:
    """每個城市各自檢定，全部一起做 FDR，再彙總每一對在幾個城市顯著、符號是否一致。"""
    series = load_series(anomalies, trends, "point")
    variables = [v for v in order if any((v, c) in series for c in cities)]
    tests = []
    for a, b in combinations(variables, 2):
        if same_quantity(a, b, params):
            continue
        for lag in params.lags:
            for source, target in ((a, b), (b, a)) if lag else ((a, b),):
                for city in cities:
                    if (source, city) not in series or (target, city) not in series:
                        continue
                    index, x, y = align(
                        *series[(source, city)], *series[(target, city)], lag=lag
                    )
                    if index.size < params.min_common_months:
                        continue
                    test = correlation_test(index, x, y)
                    if test["r"] is not None:
                        tests.append(
                            {
                                "source": source,
                                "target": target,
                                "lag": lag,
                                "city": city,
                                **test,
                            }
                        )
    for test, q in zip(tests, benjamini_hochberg([t["p"] for t in tests]), strict=True):
        test["q"] = q
    keys = sorted(
        {(t["source"], t["target"], t["lag"]) for t in tests},
        key=lambda k: (k[2], order.index(k[0]), order.index(k[1])),
    )
    pairs = []
    for source, target, lag in keys:
        items = [
            t
            for t in tests
            if (t["source"], t["target"], t["lag"]) == (source, target, lag)
        ]
        significant = [t for t in items if t["q"] < params.alpha]
        positive = sum(1 for t in significant if t["r"] > 0)
        pairs.append(
            {
                "source": source,
                "target": target,
                "lag": lag,
                "n_cities": len(items),
                "n_significant": len(significant),
                "n_significant_positive": positive,
                "n_significant_negative": len(significant) - positive,
                "sign_consistent": bool(significant)
                and positive in (0, len(significant)),
                "r_median": float(np.median([t["r"] for t in items])),
                "r_min": float(min(t["r"] for t in items)),
                "r_max": float(max(t["r"] for t in items)),
                "cities_significant": sorted(t["city"] for t in significant),
            }
        )
    return {
        "cities": cities,
        "variables": variables,
        "n_tests": len(tests),
        "n_significant": sum(1 for t in tests if t["q"] < params.alpha),
        "n_pairs": len(pairs),
        "pairs": pairs,
    }


def pgrouting_check(
    env_file: Path, tables: dict[str, dict[str, Any]], started: datetime
) -> dict[str, Any]:
    """把節點與邊寫進資料庫，用 pgr_connectedComponents 算分量與度數，和 union-find 逐節點核對。"""
    from trend_detective import pg

    out: dict[str, Any] = {}
    with pg.connect(env_file) as conn:
        conn.execute(pg._sql(MIGRATION.read_text(encoding="utf-8")))
        conn.execute("TRUNCATE analysis.correlation_edges, analysis.correlation_nodes")
        for kind, table in tables.items():
            node_id = {n["variable_id"]: n["node_id"] for n in table["nodes"]}
            with conn.cursor() as cursor:
                cursor.executemany(
                    "INSERT INTO analysis.correlation_nodes VALUES (%s, %s, %s, %s, %s)",
                    [
                        (
                            kind,
                            n["node_id"],
                            n["variable_id"],
                            n["component"],
                            n["degree"],
                        )
                        for n in table["nodes"]
                    ],
                )
                cursor.executemany(
                    "INSERT INTO analysis.correlation_edges VALUES"
                    " (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    [
                        (
                            kind,
                            e["edge_id"],
                            node_id[e["source"]],
                            node_id[e["target"]],
                            e["source"],
                            e["target"],
                            e["lag"],
                            e["r"],
                            e["p"],
                            e["q"],
                            e["n_eff"],
                            e["significant"],
                        )
                        for e in table["edges"]
                    ],
                )
            rows = conn.execute(
                "SELECT node_id, component, degree"
                " FROM analysis.correlation_components(%s) ORDER BY 1",
                (kind,),
            ).fetchall()
            expected = {n["node_id"]: n for n in table["nodes"]}
            out[kind] = {
                "n_nodes": len(rows),
                "n_components": len({row[1] for row in rows}),
                "n_nodes_component_differs_from_union_find": sum(
                    1 for row in rows if expected[row[0]]["component"] != row[1]
                ),
                "n_nodes_degree_differs": sum(
                    1 for row in rows if expected[row[0]]["degree"] != row[2]
                ),
            }
        pg.record_run(
            conn,
            "variable_graph",
            started,
            {},
            {
                "analysis.correlation_nodes": sum(
                    len(t["nodes"]) for t in tables.values()
                ),
                "analysis.correlation_edges": sum(
                    len(t["edges"]) for t in tables.values()
                ),
            },
        )
        conn.commit()
    return out


def run(
    anomalies: dict[str, Any],
    trends: dict[str, Any],
    world_anomalies: dict[str, Any] | None,
    world_trends: dict[str, Any] | None,
    catalog: dict[str, Any],
    world_catalog: dict[str, Any] | None,
    core_paths: dict[str, str],
    kind_rules: list[dict[str, str]],
    params: GraphParams,
) -> dict[str, Any]:
    order = [v["id"] for v in catalog["variables"]]
    issues: dict[str, list[str]] = {}
    for entry in trends["series"].values():
        if entry["location_id"] in params.exclude_locations:
            continue
        found = issues.setdefault(entry["variable_id"], [])
        for issue in entry.get("known_issues", []):
            if issue not in found:
                found.append(issue)
    tables = {
        kind: table_graph(
            load_series(anomalies, trends, aggregation), order, issues, params
        )
        for kind, aggregation in params.tables
    }
    used = sorted(
        {n["variable_id"] for t in tables.values() for n in t["nodes"]},
        key=order.index,
    )
    variables = {
        v["id"]: {
            "name_en": v["name_en"],
            "data_kind": cleaning.data_kind_for(v, kind_rules)[0],
            "category_path": core_paths.get(v["id"], "unclassified"),
            "known_issues": sorted(issues.get(v["id"], [])),
        }
        for v in catalog["variables"]
        if v["id"] in used
    }
    world = None
    if world_anomalies and world_trends and world_catalog:
        cities = [
            loc["id"]
            for loc in world_catalog["locations"]
            if loc.get("group") in params.world_groups
        ]
        world = world_summary(
            world_anomalies, world_trends, order, sorted(cities), params
        )
    return _round(
        {
            "schema_version": SCHEMA_VERSION,
            "exploratory": True,
            "note": NOTE,
            "significance_note": SIGNIFICANCE_NOTE,
            "input": {
                "anomalies": "data/analysis/anomalies.json",
                "world_anomalies": "data/analysis/world/anomalies.json",
                "snapshot_generated_at": anomalies["input"].get(
                    "snapshot_generated_at"
                ),
            },
            "parameters": asdict(params),
            "packages": {name: version(name) for name in PACKAGES},
            "methods": {
                "anomaly": (
                    "monthly anomaly (calendar-month mean removed) minus the "
                    "series' own least-squares line; no gap filling, each pair "
                    "uses the months both series have"
                ),
                "lag": (
                    "lag 0 pairs the same month; lag 1 pairs the source one month "
                    "earlier with the target (source leads), tested in both directions"
                ),
                "pooled": (
                    "r is computed over all locations of the table after "
                    "standardising each location; the test uses the median "
                    "effective sample size of the locations"
                ),
                "graph": (
                    "edges are the tests with q < alpha; components and degree "
                    "use those edges only (degree counts distinct neighbours)"
                ),
                "world": (
                    "each city is tested on its own; one Benjamini-Hochberg "
                    "correction over all cities, pairs and lags; the table counts "
                    "the cities where a pair is significant and whether the sign agrees"
                ),
            },
            "variables": variables,
            "tables": tables,
            "world_cities": world,
            "pgrouting": None,
        }
    )


def main(argv: list[str] | None = None) -> int:
    from trend_detective import pg

    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--env-file", type=Path, default=pg.ENV_FILE)
    parser.add_argument(
        "--no-db", action="store_true", help="不連資料庫（不跑 pgRouting）"
    )
    args = parser.parse_args(argv)
    started = datetime.now(UTC)

    def read(path: Path) -> dict[str, Any] | None:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    anomalies = read(args.analysis_dir / "anomalies.json")
    trends = read(args.analysis_dir / "trends.json")
    catalog = read(args.snapshot_dir / "catalog.json")
    if anomalies is None or trends is None or catalog is None:
        raise SystemExit("找不到 anomalies.json、trends.json 或 catalog.json")
    result = run(
        anomalies,
        trends,
        read(args.analysis_dir / "world" / "anomalies.json"),
        read(args.analysis_dir / "world" / "trends.json"),
        catalog,
        read(args.snapshot_dir / "world" / "catalog.json"),
        taxonomy.load_taxonomy()["core"],
        cleaning.load_data_kind_rules(),
        GraphParams(),
    )
    if not args.no_db:
        result["pgrouting"] = pgrouting_check(args.env_file, result["tables"], started)
    _dump(args.analysis_dir / "variable_graph.json", result)
    summary = {
        "tables": {
            kind: {
                key: table[key]
                for key in (
                    "locations",
                    "n_tests",
                    "n_significant",
                    "n_significant_by_lag",
                    "n_components",
                )
            }
            | {"n_nodes": len(table["nodes"])}
            for kind, table in result["tables"].items()
        },
        "world_cities": result["world_cities"]
        and {
            key: result["world_cities"][key]
            for key in ("n_tests", "n_significant", "n_pairs")
        },
        "pgrouting": result["pgrouting"],
    }
    _dump(
        args.analysis_dir / "variable_graph.run.json",
        {
            "command": "uv run python -m trend_detective.variable_graph",
            "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "exploratory": True,
            "input": result["input"],
            "parameters": result["parameters"],
            "packages": result["packages"],
            "outputs": ["variable_graph.json"],
            "summary": summary,
        },
    )
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
