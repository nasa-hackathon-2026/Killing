"""相似序列（#111，探索性）：把 pgvector 的序列向量匯出成網站讀的靜態檔。

    uv run python -m trend_detective.similar_series     # 需要清洗資料庫（pg load、clean、derive）

相似只是「這段期間的月距平一起高、一起低」，不是因果，也不代表物理上有關。

範圍：網站上看得到的序列——台灣 5 個點位、12 個世界城市、全球平均，乘上 12 個核心圖層變數
（`data/seed/world_subset.json` 列的那些；世界城市與全球沒有 MODIS）。候選也只在這一批裡找：
資料庫另有六千多條擴充序列，多半是同一個產品的其他層或晝夜版本，放進來前幾名會全是近乎重複
的變數。

做法：

1. 向量來自 `analysis.series_embeddings`（`db/migrations/011_vector.sql`）：2005-01 至
   2025-08 共 248 個月的距平（去掉月氣候值，缺月依補值政策補），標準化成平均 0、標準差 1，
   所以 cosine 相似度就是這段期間距平的 Pearson 相關係數。**沒有去趨勢**。
2. 每條序列列出相似度最高的 `top_k` 條與最低（最負）的 `bottom_k` 條**不同變數**的序列，
   可以跨地點；同量變數（`same_quantity_groups`）不列；輔助變數本來就不在範圍裡。
3. 顯著性：相似度當成相關係數，用兩條序列各自 lag-1 自相關修正後的有效樣本數做 t 檢定
   （`mining_stats`）。BH-FDR 的範圍是**這一批裡全部可列的配對**（不同變數、非同量），不是
   只有列出來的前幾名——只對挑出來的前幾名做校正會偏樂觀。不顯著的照樣列，標 `significant`。
4. 共同趨勢會造成相似：兩條都先減掉自己的線性趨勢、重新標準化，再算一次相似度
   （`cosine_detrended`，另做一次同樣的檢定與 FDR）。兩個相似度相差超過
   `trend_sensitive_delta` 或正負號相反的標 `trend_sensitive`。
5. 核對：資料庫用 pgvector 的 `<=>` 對同一批配對算的相似度，和這裡用 numpy 算的逐對比較，
   最大差寫在 `check`（向量存成 float4）。

參數在跑之前定好（`SimilarParams`），寫進結果檔；沒有其他嘗試。資料庫沒變時重跑，結果檔逐
位元組相同。
"""

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import numpy as np

from trend_detective.mining import MiningParams
from trend_detective.mining_stats import correlation_p, detrend, standardize
from trend_detective.pg_extensions import EMBEDDING_WINDOW
from trend_detective.trends import (
    ANALYSIS_DIR,
    _dump,
    _round,
    benjamini_hochberg,
    lag1_autocorrelation,
)

SCHEMA_VERSION = 1
PACKAGES = ("numpy", "scipy")
WORLD_SUBSET = Path("data/seed/world_subset.json")
NOTE = (
    "Exploratory. Similarity is the correlation of monthly anomalies over one "
    "period; it does not show cause and effect, and two series that both have a "
    "long-term trend look similar for that reason alone."
)


@dataclass(frozen=True)
class SimilarParams:
    top_k: int = 5
    bottom_k: int = 3
    alpha: float = 0.05
    trend_sensitive_delta: float = 0.1
    # (地點群組, 聚合方式, tier)：網站上看得到的序列
    scopes: tuple[tuple[str, str, str], ...] = (
        ("taiwan", "point", "core"),
        ("world_city", "point", "extended"),
        ("global", "area_mean_grid", "extended"),
    )
    global_locations: tuple[str, ...] = ("global",)
    same_quantity_groups: tuple[tuple[str, ...], ...] = (
        MiningParams().same_quantity_groups
    )
    check_tolerance: float = 1e-5
    series_decimals: int = 2


def same_quantity(a: str, b: str, params: SimilarParams) -> bool:
    return any(a in group and b in group for group in params.same_quantity_groups)


def effective_n_matrix(vectors: np.ndarray) -> np.ndarray:
    """每一對的有效樣本數：n × (1 − r1a × r1b) ÷ (1 + r1a × r1b)，夾在 3 與 n 之間。"""
    n = vectors.shape[1]
    index = np.arange(n, dtype=np.int64)
    r1 = np.array([lag1_autocorrelation(index, row) for row in vectors])
    product = np.outer(r1, r1)
    with np.errstate(divide="ignore", invalid="ignore"):
        n_eff = n * (1 - product) / (1 + product)
    n_eff = np.where(product >= 1, 3.0, n_eff)
    return np.clip(n_eff, 3.0, float(n))


def similarity(vectors: np.ndarray) -> np.ndarray:
    """列已標準化（平均 0、母體標準差 1）時，這就是 cosine 相似度，也是 Pearson 相關。"""
    return vectors @ vectors.T / vectors.shape[1]


def detrended_vectors(vectors: np.ndarray) -> np.ndarray:
    index = np.arange(vectors.shape[1], dtype=np.int64)
    return np.array([standardize(detrend(index, row)) for row in vectors])


def allowed_pairs(variables: list[str], params: SimilarParams) -> np.ndarray:
    """可列的配對：不同變數且不是同量變數。回傳布林矩陣。"""
    n = len(variables)
    allowed = np.zeros((n, n), dtype=bool)
    for i in range(n):
        for j in range(n):
            allowed[i, j] = variables[i] != variables[j] and not same_quantity(
                variables[i], variables[j], params
            )
    return allowed


def q_matrix(cosine: np.ndarray, n_eff: np.ndarray, allowed: np.ndarray) -> np.ndarray:
    """可列配對（每一對只算一次）的 p 值做 BH-FDR，回傳對稱的 q 矩陣（不可列的是 NaN）。"""
    upper = np.triu(allowed, k=1)
    rows, columns = np.nonzero(upper)
    p_values = [
        correlation_p(float(cosine[i, j]), float(n_eff[i, j]))
        for i, j in zip(rows, columns, strict=True)
    ]
    q = np.full(cosine.shape, np.nan)
    for i, j, value in zip(rows, columns, benjamini_hochberg(p_values), strict=True):
        q[i, j] = q[j, i] = value
    return q


def neighbours(
    cosine: np.ndarray, allowed: np.ndarray, params: SimilarParams
) -> list[tuple[list[int], list[int]]]:
    """每條序列的 (最相似的 top_k 條, 最不相似的 bottom_k 條) 的列號；同分時列號小的在前。"""
    out = []
    for i in range(cosine.shape[0]):
        candidates = np.nonzero(allowed[i])[0]
        ranked = sorted(candidates.tolist(), key=lambda j: (-cosine[i, j], j))
        top = ranked[: params.top_k]
        rest = [j for j in ranked if j not in top]
        bottom = sorted(rest, key=lambda j: (cosine[i, j], j))[: params.bottom_k]
        out.append((top, bottom))
    return out


def read_pool(
    conn: Any, core_ids: list[str], params: SimilarParams
) -> list[dict[str, Any]]:
    rows = []
    for group, aggregation, tier in params.scopes:
        found = conn.execute(
            "SELECT s.series_id, s.variable_id, s.location_id, s.aggregation,"
            " l.name_en, l.location_group, q.known_issues, e.n_filled,"
            " e.embedding::text, e.first_month, e.last_month"
            " FROM meta.series s"
            " JOIN meta.locations l ON l.id = s.location_id"
            " JOIN clean.series_summary q USING (series_id)"
            " JOIN analysis.series_embeddings e USING (series_id)"
            " WHERE l.location_group = %s AND s.aggregation = %s AND s.tier = %s"
            " AND s.variable_id = ANY(%s)"
            " AND (l.location_group <> 'global' OR s.location_id = ANY(%s))",
            (group, aggregation, tier, core_ids, list(params.global_locations)),
        ).fetchall()
        for row in found:
            rows.append(
                {
                    "series_id": row[0],
                    "variable_id": row[1],
                    "location_id": row[2],
                    "aggregation": row[3],
                    "location_name_en": row[4],
                    "location_group": row[5],
                    "known_issues": sorted(row[6] or []),
                    "n_filled": row[7],
                    "vector": np.array(json.loads(row[8]), dtype=float),
                    "first_month": row[9].isoformat(),
                    "last_month": row[10].isoformat(),
                }
            )
    return rows


def database_check(conn: Any, pool: list[dict[str, Any]], cosine: np.ndarray) -> float:
    """pgvector 對同一批序列兩兩算的 cosine 相似度，與 numpy 的最大絕對差。"""
    position = {item["series_id"]: i for i, item in enumerate(pool)}
    ids = list(position)
    worst = 0.0
    for a, b, value in conn.execute(
        "SELECT a.series_id, b.series_id, 1 - (a.embedding <=> b.embedding)"
        " FROM analysis.series_embeddings a JOIN analysis.series_embeddings b"
        " ON a.series_id < b.series_id"
        " WHERE a.series_id = ANY(%s) AND b.series_id = ANY(%s)",
        (ids, ids),
    ):
        worst = max(worst, abs(float(value) - float(cosine[position[a], position[b]])))
    return worst


def build(
    pool: list[dict[str, Any]],
    order: list[str],
    variable_names: dict[str, str],
    params: SimilarParams,
) -> dict[str, Any]:
    """純計算：`pool` 的每一筆要有 variable_id、location_id、aggregation、vector 等欄位。"""
    groups = [scope[0] for scope in params.scopes]
    pool = sorted(
        pool,
        key=lambda item: (
            groups.index(item["location_group"]),
            item["location_id"],
            order.index(item["variable_id"]),
        ),
    )
    keys = [
        f"{item['variable_id']}__{item['location_id']}__{item['aggregation']}"
        for item in pool
    ]
    variables = [item["variable_id"] for item in pool]
    # 向量存成 float4；重新標準化讓 cosine 精確等於相關係數
    vectors = np.array([standardize(item["vector"]) for item in pool])
    flat = detrended_vectors(vectors)
    cosine, cosine_flat = similarity(vectors), similarity(flat)
    allowed = allowed_pairs(variables, params)
    n_eff, n_eff_flat = effective_n_matrix(vectors), effective_n_matrix(flat)
    q, q_flat = (
        q_matrix(cosine, n_eff, allowed),
        q_matrix(cosine_flat, n_eff_flat, allowed),
    )

    def entry(i: int, j: int) -> dict[str, Any]:
        raw, without = float(cosine[i, j]), float(cosine_flat[i, j])
        return {
            "series": keys[j],
            "cosine": raw,
            "cosine_detrended": without,
            "n_eff": float(n_eff[i, j]),
            "q": float(q[i, j]),
            "significant": bool(q[i, j] < params.alpha),
            "q_detrended": float(q_flat[i, j]),
            "significant_detrended": bool(q_flat[i, j] < params.alpha),
            "trend_sensitive": abs(raw - without) > params.trend_sensitive_delta
            or raw * without < 0,
        }

    results = {}
    listed = []
    for i, (top, bottom) in enumerate(neighbours(cosine, allowed, params)):
        results[keys[i]] = {
            "most_similar": [entry(i, j) for j in top],
            "least_similar": [entry(i, j) for j in bottom],
        }
        listed += results[keys[i]]["most_similar"] + results[keys[i]]["least_similar"]
    n_pairs = int(np.triu(allowed, k=1).sum())
    upper = np.triu(allowed, k=1)
    locations: dict[str, dict[str, str]] = {}
    for item in pool:
        locations.setdefault(
            item["location_id"],
            {"name_en": item["location_name_en"], "group": item["location_group"]},
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "exploratory": True,
        "note": NOTE,
        "input": {
            "database": "analysis.series_embeddings (pg load, pg clean, pg derive)",
            "scope": str(WORLD_SUBSET),
        },
        "parameters": asdict(params),
        "packages": {name: version(name) for name in PACKAGES},
        "methods": {
            "vector": (
                "monthly anomaly (calendar-month mean of the whole series removed, "
                "gaps filled by the mining gap policy) over the window, "
                "standardised to mean 0 and standard deviation 1; the cosine "
                "similarity of two vectors equals the Pearson correlation of the "
                "two anomaly series. No trend is removed"
            ),
            "candidates": (
                "only the series shown on the website (the same list as the "
                "queries); a different variable, not in the same quantity group; "
                "any location"
            ),
            "significance": (
                "t test of the similarity as a correlation with an effective "
                "sample size corrected for the lag-1 autocorrelation of both "
                "series; Benjamini-Hochberg over all candidate pairs, not only "
                "the listed ones"
            ),
            "detrended": (
                "both series have their own least-squares line removed and are "
                "standardised again before the similarity is computed; "
                "trend_sensitive marks pairs whose two similarities differ by "
                "more than trend_sensitive_delta or have opposite signs"
            ),
        },
        "window": {
            "first_month": EMBEDDING_WINDOW[0],
            "last_month": EMBEDDING_WINDOW[1],
            "n_months": int(vectors.shape[1]),
        },
        "summary": {
            "n_series": len(pool),
            "n_series_by_group": {
                group: sum(1 for item in pool if item["location_group"] == group)
                for group in groups
            },
            "n_candidate_pairs": n_pairs,
            "n_candidate_pairs_significant": int((q[upper] < params.alpha).sum()),
            "n_candidate_pairs_significant_detrended": int(
                (q_flat[upper] < params.alpha).sum()
            ),
            "n_listed": len(listed),
            "n_listed_significant": sum(1 for e in listed if e["significant"]),
            "n_listed_significant_detrended": sum(
                1 for e in listed if e["significant_detrended"]
            ),
            "n_listed_trend_sensitive": sum(1 for e in listed if e["trend_sensitive"]),
        },
        "variable_names": {
            v: variable_names.get(v, v) for v in order if v in set(variables)
        },
        "locations": locations,
        "series": {
            key: {
                "variable_id": item["variable_id"],
                "location_id": item["location_id"],
                "aggregation": item["aggregation"],
                "known_issues": item["known_issues"],
                "n_filled": item["n_filled"],
                "z": [round(float(v), params.series_decimals) for v in vector],
            }
            for key, item, vector in zip(keys, pool, vectors, strict=True)
        },
        "results": results,
    }


def main(argv: list[str] | None = None) -> int:
    from trend_detective import pg

    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    parser.add_argument("--env-file", type=Path, default=pg.ENV_FILE)
    parser.add_argument("--scope-file", type=Path, default=WORLD_SUBSET)
    args = parser.parse_args(argv)
    params = SimilarParams()
    order = [
        item["core_id"]
        for item in json.loads(args.scope_file.read_text(encoding="utf-8"))["variables"]
    ]
    with pg.connect(args.env_file) as conn:
        pool = read_pool(conn, order, params)
        names = dict(
            conn.execute(
                "SELECT id, name_en FROM meta.variables WHERE id = ANY(%s)", (order,)
            ).fetchall()
        )
        result = build(pool, order, names, params)
        ordered = sorted(
            pool,
            key=lambda item: list(result["series"]).index(
                f"{item['variable_id']}__{item['location_id']}__{item['aggregation']}"
            ),
        )
        worst = database_check(
            conn,
            ordered,
            similarity(np.array([standardize(item["vector"]) for item in ordered])),
        )
    result["check"] = {
        "pgvector_matches_numpy": worst <= params.check_tolerance,
        "tolerance": params.check_tolerance,
    }
    result = _round(result)
    _dump(args.analysis_dir / "similar_series.json", result, compact=True)
    _dump(
        args.analysis_dir / "similar_series.run.json",
        {
            "command": "uv run python -m trend_detective.similar_series",
            "generated_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "exploratory": True,
            "input": result["input"],
            "parameters": result["parameters"],
            "packages": result["packages"],
            "outputs": ["similar_series.json"],
            "window": result["window"],
            "summary": result["summary"],
            "check": {**result["check"], "max_abs_difference": worst},
        },
    )
    print(json.dumps({**result["summary"], "check_max_abs_difference": worst}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
