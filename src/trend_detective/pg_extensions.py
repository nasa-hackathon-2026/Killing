"""清洗資料庫用到的其他 PostgreSQL 擴充（#91）：載入、衍生表與核對。

每個擴充的表、函式與 view 定義在 `db/migrations/009_*.sql` 之後的檔；這裡是需要 Python 的部分：

- `load_taxonomy`、`load_rasters`、`refresh_after_load`：`pg load` 的最後幾步（ltree 的分類、
  postgis_raster 的趨勢與逐年平均、H3 的彙整、BM25 的文件）。
- `derive`：`pg derive`，要先有清洗與分析結果：pgvector 的序列向量、pgRouting 的關聯圖、
  tablefunc 的探勘寬表。
- `extension_status`：`pg status` 用，各擴充的版本與對應物件的列數。
- `run_checks`：`pg check`，把資料庫裡算的結果和 Python 的結果逐值比對，回傳數字。

這個模組的函式都只接已開好的連線，不讀連線設定。
"""

import json
import math
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any, LiteralString, cast

import numpy as np
import psycopg

from trend_detective import mining, taxonomy
from trend_detective.cleaning import index_month
from trend_detective.grid import read_frontend
from trend_detective.grid_derive import SEED_FILES, read_coarse
from trend_detective.grid_fetch import GridProduct, load_products

RASTER_NODATA = -9999.0
# 序列向量的期間；與 db/migrations/011_vector.sql 相同
EMBEDDING_WINDOW = ("2005-01-01", "2025-08-01")
# (擴充, 對應的物件, 數列數的 SQL；None 表示沒有可數的物件)
EXTENSION_OBJECTS: tuple[tuple[str, str, str | None], ...] = (
    ("timescaledb", "obs.observations", "SELECT count(*) FROM obs.observations"),
    ("postgis", "geo.grid_cells", "SELECT count(*) FROM geo.grid_cells"),
    ("pg_trgm", "meta.variables", "SELECT count(*) FROM meta.variables"),
    ("postgis_raster", "geo.trend_rasters", "SELECT count(*) FROM geo.trend_rasters"),
    (
        "postgis_raster",
        "geo.annual_mean_rasters",
        "SELECT count(*) FROM geo.annual_mean_rasters",
    ),
    (
        "postgis_raster",
        "geo.monthly_rasters",
        "SELECT count(*) FROM geo.monthly_rasters",
    ),
    (
        "ltree",
        "meta.variables.category_path",
        "SELECT count(category_path) FROM meta.variables",
    ),
    (
        "vector",
        "analysis.series_embeddings",
        "SELECT count(*) FROM analysis.series_embeddings",
    ),
    ("h3", "geo.h3_trends", "SELECT count(*) FROM geo.h3_trends"),
    (
        "h3_postgis",
        "geo.grid_cells.h3_res3",
        "SELECT count(h3_res3) FROM geo.grid_cells",
    ),
    (
        "timescaledb_toolkit",
        "clean.toolkit_climatology",
        "SELECT count(*) FROM clean.toolkit_climatology",
    ),
    (
        "pgrouting",
        "analysis.variable_graph",
        "SELECT count(*) FROM analysis.variable_graph",
    ),
    (
        "pgrouting",
        "analysis.variable_graph_nodes",
        "SELECT count(*) FROM analysis.variable_graph_nodes",
    ),
    (
        "tablefunc",
        "analysis.mining_wide_point",
        "SELECT count(*) FROM analysis.mining_wide_point",
    ),
    (
        "tablefunc",
        "analysis.mining_wide_region",
        "SELECT count(*) FROM analysis.mining_wide_region",
    ),
    (
        "plpython3u",
        "analysis.mann_kendall（函式）",
        "SELECT count(*) FROM pg_proc WHERE proname = 'mann_kendall_values'",
    ),
    (
        "pg_textsearch",
        "meta.search_documents",
        "SELECT count(*) FROM meta.search_documents",
    ),
    (
        "file_fdw",
        "raw.file_planetary_computer",
        "SELECT count(*) FROM raw.file_planetary_computer",
    ),
    (
        "pg_cron",
        "cron.job",
        "SELECT count(*) FROM cron.job WHERE jobname = 'trend-detective-daily-refresh'",
    ),
    (
        "btree_gist",
        "meta.known_issues_no_overlap（約束）",
        "SELECT count(*) FROM pg_constraint WHERE conname = 'known_issues_no_overlap'",
    ),
    ("unit", "meta.display_units", "SELECT count(*) FROM meta.display_units"),
)


def _sql(text: str) -> LiteralString:
    """組出來的 SQL。只接這個模組自己的常數，不接使用者輸入。"""
    return cast(LiteralString, text)


def _one(conn: psycopg.Connection[Any], query: str, *params: Any) -> tuple[Any, ...]:
    row = conn.execute(_sql(query), params or None).fetchone()
    assert row is not None
    return row


# ---------------------------------------------------------------- load 的最後幾步


def load_taxonomy(
    conn: psycopg.Connection[Any], variables: list[dict[str, Any]], seed_file: Path
) -> dict[str, int]:
    """ltree：依規則檔寫 `meta.variables.category_path`。沒有規則檔就全部留 NULL。"""
    if not seed_file.exists():
        return {}
    rules = taxonomy.load_taxonomy(seed_file)
    assigned = taxonomy.classify(variables, rules)
    with conn.cursor() as cursor:
        cursor.executemany(
            "UPDATE meta.variables SET category_path = %s::ltree, category_basis = %s"
            " WHERE id = %s",
            [(path, basis, variable) for variable, (path, basis) in assigned.items()],
        )
    counts = {"manual": 0, "rule": 0, "unclassified": 0}
    for _, basis in assigned.values():
        counts[basis.split(":")[0]] += 1
    return counts


def _rows(values: np.ndarray, missing: np.ndarray) -> list[list[float | None]]:
    """二維陣列（第一列是最南邊）→ 給 raster 的列（第一列是最北邊），缺值是 None。"""
    flipped = np.flipud(values).astype(float)
    mask = np.flipud(missing)
    return [
        [
            None if absent else float(value)
            for value, absent in zip(row, gone, strict=True)
        ]
        for row, gone in zip(flipped, mask, strict=True)
    ]


def load_rasters(conn: psycopg.Connection[Any], grid_dir: Path) -> dict[str, int]:
    """postgis_raster：每個有趨勢地圖的變數一張趨勢 raster，加上每年一張逐年平均。"""
    counts = {"geo.trend_rasters": 0, "geo.annual_mean_rasters": 0}
    for directory in sorted(
        p for p in grid_dir.glob("*") if (p / "meta.json").exists()
    ):
        meta, arrays = read_frontend(directory)
        if "trend" not in meta:
            continue
        grid = meta["grid"]
        georeference = (
            float(grid["lon_west_edge"]),
            float(grid["lat_south_edge"]) + grid["n_lat"] * float(grid["lat_step"]),
            float(grid["lon_step"]),
            float(grid["lat_step"]),
        )
        slope = arrays["trend_slope_per_decade"][0]
        significance = arrays["trend_significance"][0]
        # 與 geo.grid_cells 相同：只留有分析（顯著性類別 1–3）而且斜率有值的格子
        absent = (significance == 0) | np.isnan(slope)
        conn.execute(
            "INSERT INTO geo.trend_rasters SELECT %s, ST_AddBand("
            " geo.make_raster(%s, %s, %s, %s, %s::float8[], '32BF', %s),"
            " geo.make_raster(%s, %s, %s, %s, %s::float8[], '8BUI', 0))",
            (
                meta["id"],
                *georeference,
                _rows(slope, absent),
                RASTER_NODATA,
                *georeference,
                _rows(significance, absent),
            ),
        )
        counts["geo.trend_rasters"] += 1
        layer = next((e for e in meta["layers"] if e["name"] == "annual_mean"), None)
        if layer is None or "annual_mean" not in arrays:
            continue
        for label, values in zip(layer["labels"], arrays["annual_mean"], strict=True):
            conn.execute(
                "INSERT INTO geo.annual_mean_rasters SELECT %s, %s, %s,"
                " geo.make_raster(%s, %s, %s, %s, %s::float8[], '32BF', %s)",
                (
                    meta["id"],
                    int(label),
                    layer.get("unit"),
                    *georeference,
                    _rows(values, np.isnan(values)),
                    RASTER_NODATA,
                ),
            )
            counts["geo.annual_mean_rasters"] += 1
    return counts


def _coarse_months(job: tuple[GridProduct, Path]) -> tuple[str, Any]:
    product, cube_path = job
    return product.id, read_coarse(product, cube_path)


def load_monthly_rasters(
    conn: psycopg.Connection[Any],
    raw_grid_dir: Path,
    *,
    since: str | None = None,
    workers: int = 4,
    seed_files: tuple[Path, ...] = SEED_FILES,
) -> dict[str, Any]:
    """postgis_raster：有趨勢地圖的變數，每個月一張 raster（`geo.monthly_rasters`，整批換新）。

    來源是原始立方體 `<raw_grid_dir>/<id>/<id>.nc`，逐月降到衍生檔的網格（`grid_derive.read_coarse`，
    和趨勢地圖同一個算法）。`since`（`YYYY-MM`）只載這個月之後的月份。沒有立方體的變數略過。
    """
    wanted = {row[0] for row in conn.execute("SELECT variable_id FROM geo.grid_layers")}
    products = {
        product.id: product
        for seed in seed_files
        if seed.exists()
        for product in load_products(seed)
        if product.id in wanted and product.derive
    }
    jobs = [
        (product, raw_grid_dir / name / f"{name}.nc")
        for name, product in sorted(products.items())
        if (raw_grid_dir / name / f"{name}.nc").exists()
    ]
    conn.execute("TRUNCATE geo.monthly_rasters")
    counts: dict[str, Any] = {
        "geo.monthly_rasters": 0,
        "variables": [],
        "skipped_no_cube": sorted(wanted - {job[0].id for job in jobs}),
    }
    with ProcessPoolExecutor(max_workers=max(1, min(workers, len(jobs) or 1))) as pool:
        for name, built in pool.map(_coarse_months, jobs):
            grid = built.grid
            assert grid is not None and built.coarse is not None
            georeference = (
                float(grid.lon_west),
                float(grid.lat_south) + grid.n_lat * float(grid.lat_step),
                float(grid.lon_step),
                float(grid.lat_step),
            )
            n = 0
            for month, values in zip(built.months, built.coarse, strict=True):
                if since is not None and month.isoformat()[:7] < since:
                    continue
                conn.execute(
                    "INSERT INTO geo.monthly_rasters SELECT %s, %s, %s,"
                    " geo.make_raster(%s, %s, %s, %s, %s::float8[], '32BF', %s)",
                    (
                        name,
                        month,
                        built.unit,
                        *georeference,
                        _rows(values, np.isnan(values)),
                        RASTER_NODATA,
                    ),
                )
                n += 1
            counts["geo.monthly_rasters"] += n
            counts["variables"].append(name)
    return counts


def check_monthly_rasters(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    """月 raster 的區域平均（緯度加權）對照格點區域平均的序列（原始解析度、cos 緯度加權）。"""
    n = int(_one(conn, "SELECT count(*) FROM geo.monthly_rasters")[0])
    if n == 0:
        return {"n_rasters": 0}
    rows = conn.execute(
        "SELECT l.variable_id, r.region_id, count(*),"
        " max(abs(m.lat_weighted_mean - o.value_raw) / nullif(abs(o.value_raw), 0)),"
        " percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(m.lat_weighted_mean - o.value_raw)"
        "   / nullif(abs(o.value_raw), 0)),"
        " corr(m.lat_weighted_mean, o.value_raw)"
        " FROM geo.grid_layers l CROSS JOIN (VALUES ('global'), ('asia'), ('taiwan'))"
        "   AS r (region_id)"
        " CROSS JOIN LATERAL geo.region_raster_monthly_mean(l.variable_id, r.region_id) m"
        " JOIN meta.series s ON s.variable_id = l.variable_id"
        "  AND s.location_id = r.region_id AND s.aggregation = 'area_mean_grid'"
        " JOIN obs.observations o ON o.series_id = s.series_id AND o.month = m.month"
        " GROUP BY 1, 2 ORDER BY 1, 2"
    ).fetchall()
    span = _one(
        conn,
        "SELECT min(month)::text, max(month)::text, count(DISTINCT variable_id),"
        " pg_size_pretty(pg_total_relation_size('geo.monthly_rasters'))"
        " FROM geo.monthly_rasters",
    )
    return {
        "n_rasters": n,
        "first_month": span[0],
        "last_month": span[1],
        "n_variables": int(span[2]),
        "table_size": span[3],
        "vs_area_mean_grid_series": {
            f"{row[0]}/{row[1]}": {
                "n_months": int(row[2]),
                "max_relative_difference": row[3],
                "median_relative_difference": row[4],
                "correlation": row[5],
            }
            for row in rows
        },
    }


def refresh_after_load(conn: psycopg.Connection[Any]) -> dict[str, int]:
    """H3 的彙整表與 BM25 的文件：只依賴 `load` 載入的表。"""
    conn.execute("REFRESH MATERIALIZED VIEW geo.h3_trends")
    return {
        "geo.h3_trends": int(_one(conn, "SELECT count(*) FROM geo.h3_trends")[0]),
        "meta.search_documents": int(
            _one(conn, "SELECT meta.refresh_search_documents()")[0]
        ),
    }


# ---------------------------------------------------------------- derive


def derive(conn: psycopg.Connection[Any]) -> dict[str, int]:
    """要先有清洗（`pg clean`）與分析結果（`pg analysis`）的衍生表。"""
    return {
        "analysis.series_embeddings": int(
            _one(conn, "SELECT analysis.refresh_series_embeddings()")[0]
        ),
        "analysis.variable_graph": int(
            _one(conn, "SELECT analysis.refresh_variable_graph()")[0]
        ),
        "analysis.variable_graph_nodes": int(
            _one(conn, "SELECT count(*) FROM analysis.variable_graph_nodes")[0]
        ),
        "analysis.mining_wide_point": int(
            _one(conn, "SELECT analysis.build_mining_wide('point')")[0]
        ),
        "analysis.mining_wide_region": int(
            _one(conn, "SELECT analysis.build_mining_wide('region')")[0]
        ),
    }


# ---------------------------------------------------------------- status


def extension_status(conn: psycopg.Connection[Any]) -> list[tuple[str, str, str, str]]:
    """每個擴充：(名稱, 版本或「未啟用」, 對應的物件, 列數或原因)。查不到的物件不會讓指令失敗。"""
    versions = dict(
        conn.execute("SELECT extname, extversion FROM pg_extension").fetchall()
    )
    rows = []
    for name, target, query in EXTENSION_OBJECTS:
        version = versions.get(name, "未啟用")
        count = "—"
        if query is not None:
            try:
                with conn.transaction():
                    count = str(_one(conn, query)[0])
            except psycopg.Error as error:
                count = f"查不到（{type(error).__name__}）"
        rows.append((name, version, target, count))
    return rows


def taxonomy_summary(conn: psycopg.Connection[Any], tier: str) -> dict[str, Any]:
    """匯出用：`tier` 這一層每個變數的分類路徑與依據，以及第一、二層各有幾個變數。"""
    has_column = _one(
        conn,
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'meta'"
        " AND table_name = 'variables' AND column_name = 'category_path'",
    )[0]
    if not has_column:
        return {}
    where = "id IN (SELECT variable_id FROM meta.series WHERE tier = %s)"
    variables = {
        row[0]: {"category_path": row[1], "basis": row[2]}
        for row in conn.execute(
            _sql(
                "SELECT id, category_path::text, category_basis FROM meta.variables"
                f" WHERE {where} AND category_path IS NOT NULL ORDER BY id"
            ),
            (tier,),
        )
    }
    counts = {
        row[0]: int(row[1])
        for row in conn.execute(
            _sql(
                "SELECT subpath(category_path, 0, least(2, nlevel(category_path)))::text,"
                f" count(*) FROM meta.variables WHERE {where}"
                " AND category_path IS NOT NULL GROUP BY 1 ORDER BY 1"
            ),
            (tier,),
        )
    }
    return {
        "note": (
            "category_path is a PostgreSQL ltree path (labels separated by dots). "
            "basis: manual (assigned by hand), rule:<n> (n-th rule of "
            "data/seed/variable_taxonomy.json) or unclassified."
        ),
        "counts_by_second_level": counts,
        "n_unclassified": sum(
            1 for v in variables.values() if v["basis"] == taxonomy.UNCLASSIFIED
        ),
        "variables": variables,
    }


# ---------------------------------------------------------------- 核對


def check_raster(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    """raster 的區域統計對照 `geo.region_grid_trends`（面積加權），以及逐年平均對照格點區域平均。"""
    rows = conn.execute(
        "SELECT variable_id, region_id, n_cells, n_pixels, grid_area_weighted_mean,"
        " raster_lat_weighted_mean, raster_pixel_mean, grid_significant_area_fraction,"
        " raster_significant_area_fraction FROM geo.region_raster_vs_grid ORDER BY 1, 2"
    ).fetchall()
    weighted = [abs(r[4] - r[5]) for r in rows]
    unweighted = [abs(r[4] - r[6]) for r in rows]
    worst = max(rows, key=lambda r: abs(r[4] - r[6]), default=None)
    annual = conn.execute(
        "SELECT a.variable_id, count(*), max(abs(a.lat_weighted_mean - y.mean_value)"
        " / nullif(abs(y.mean_value), 0)), max(abs(a.pixel_mean - y.mean_value)"
        " / nullif(abs(y.mean_value), 0))"
        " FROM (SELECT l.variable_id, m.* FROM geo.grid_layers l CROSS JOIN LATERAL"
        "       geo.region_raster_annual_mean(l.variable_id, 'global') m) a"
        " JOIN meta.series s ON s.variable_id = a.variable_id AND s.location_id = 'global'"
        "  AND s.aggregation = 'area_mean_grid'"
        " JOIN obs.yearly_mean y ON y.series_id = s.series_id"
        "  AND extract(year FROM y.year) = a.year AND y.n_months = 12"
        " GROUP BY 1 ORDER BY 1"
    ).fetchall()
    return {
        "n_variable_region_pairs": len(rows),
        "n_pairs_with_same_cell_count": sum(1 for r in rows if r[2] == r[3]),
        "max_abs_difference_lat_weighted_vs_grid": max(weighted, default=None),
        "max_abs_difference_pixel_mean_vs_grid": max(unweighted, default=None),
        "largest_pixel_mean_difference": None
        if worst is None
        else {
            "variable_id": worst[0],
            "region_id": worst[1],
            "grid_area_weighted_mean": worst[4],
            "raster_lat_weighted_mean": worst[5],
            "raster_pixel_mean": worst[6],
        },
        "max_abs_difference_significant_area_fraction": max(
            (abs((r[7] or 0.0) - (r[8] or 0.0)) for r in rows), default=None
        ),
        "global_annual_mean_vs_area_mean_grid_series": {
            r[0]: {
                "n_years": r[1],
                "max_relative_difference_lat_weighted": r[2],
                "max_relative_difference_pixel_mean": r[3],
            }
            for r in annual
        },
    }


def check_h3(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    row = _one(
        conn,
        "SELECT (SELECT count(*) FROM geo.grid_cells),"
        " (SELECT sum(n_cells) FROM geo.h3_trends WHERE resolution = 3),"
        " (SELECT sum(n_cells) FROM geo.h3_trends WHERE resolution = 2),"
        " (SELECT count(DISTINCT h3) FROM geo.h3_trends WHERE resolution = 3),"
        " (SELECT count(DISTINCT h3) FROM geo.h3_trends WHERE resolution = 2),"
        " (SELECT count(*) FROM geo.h3_trends_wide WHERE resolution = 3 AND n_variables = 7),"
        " (SELECT count(*) FROM geo.h3_trends_wide WHERE resolution = 2 AND n_variables = 7),"
        " (SELECT avg(n_cells) FROM geo.h3_trends WHERE resolution = 3),"
        " (SELECT avg(n_cells) FROM geo.h3_trends WHERE resolution = 2),"
        " (SELECT count(*) FROM geo.locations WHERE h3_res3 IS NULL)",
    )
    return {
        "n_grid_cells": int(row[0]),
        "sum_n_cells_res3": int(row[1] or 0),
        "sum_n_cells_res2": int(row[2] or 0),
        "n_h3_cells_res3": int(row[3]),
        "n_h3_cells_res2": int(row[4]),
        "n_h3_cells_with_all_7_variables_res3": int(row[5]),
        "n_h3_cells_with_all_7_variables_res2": int(row[6]),
        "mean_grid_cells_per_h3_cell_res3": float(row[7] or 0),
        "mean_grid_cells_per_h3_cell_res2": float(row[8] or 0),
        "n_locations_without_h3": int(row[9]),
    }


def check_toolkit(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    """toolkit 的月氣候值與距平、gapfill 的補值，對照 Python 清洗寫進 `clean.*` 的值。"""
    climatology = _one(
        conn,
        "SELECT count(*), count(*) FILTER (WHERE m.series_id IS NULL OR t.series_id IS NULL),"
        " max(abs(t.mean_value - m.mean_value) / greatest(abs(m.mean_value), 1e-300)),"
        " count(*) FILTER (WHERE t.n_years <> m.n_years)"
        " FROM clean.toolkit_climatology t FULL JOIN clean.monthly_climatology m"
        " USING (series_id, calendar_month)",
    )
    anomalies = _one(
        conn,
        "SELECT count(*), max(abs(anomaly_sql - anomaly)),"
        " count(*) FILTER (WHERE abs(anomaly_sql - anomaly)"
        "   > 1e-9 * greatest(1, abs(anomaly))),"
        " max(abs(anomaly_sql - anomaly) / nullif(abs(anomaly), 0))"
        "   FILTER (WHERE abs(anomaly) > 1e-6),"
        " (SELECT count(*) FROM clean.observations WHERE anomaly IS NOT NULL)"
        " FROM clean.toolkit_anomalies",
    )
    compare = (
        "SELECT count(*) FILTER (WHERE f.series_id IS NOT NULL AND o.series_id IS NOT NULL),"
        " count(*) FILTER (WHERE o.series_id IS NULL),"
        " count(*) FILTER (WHERE f.series_id IS NULL),"
        " count(*) FILTER (WHERE f.fill_method IS DISTINCT FROM o.fill_method),"
        " count(*) FILTER (WHERE o.fill_method = 'linear'),"
        " count(*) FILTER (WHERE o.fill_method = 'linear'"
        "   AND abs(f.anomaly_filled - o.anomaly_filled)"
        "     > 1e-9 * greatest(1, abs(o.anomaly_filled))),"
        " max(abs(f.anomaly_filled - o.anomaly_filled)) FILTER (WHERE o.fill_method = 'linear'),"
        " max(abs(f.anomaly_filled - o.anomaly_filled)"
        "     / nullif(abs(o.anomaly_filled), 0)) FILTER (WHERE o.fill_method = 'linear'"
        "     AND abs(o.anomaly_filled) > 1e-6),"
        " count(*) FILTER (WHERE o.fill_method = 'climatology'),"
        " count(*) FILTER (WHERE o.fill_method = 'climatology' AND f.anomaly_filled <> 0),"
        " max(abs(f.anomaly_filled - o.anomaly_filled)) FILTER (WHERE o.fill_method IS NULL)"
        " FROM clean.sql_filled_anomalies(NULL, {calendar}) f"
        " FULL JOIN (SELECT series_id, month, anomaly_filled, fill_method"
        "            FROM clean.observations WHERE anomaly_filled IS NOT NULL) o"
        " USING (series_id, month)"
    )

    def fill(calendar: str) -> dict[str, Any]:
        row = _one(conn, compare.format(calendar=calendar))
        return {
            "n_months_compared": int(row[0]),
            "n_only_in_sql": int(row[1]),
            "n_only_in_python": int(row[2]),
            "n_fill_method_differs": int(row[3]),
            "n_linear": int(row[4]),
            "n_linear_value_differs": int(row[5]),
            "max_abs_difference_linear": row[6],
            "max_relative_difference_linear": row[7],
            "n_climatology": int(row[8]),
            "n_climatology_not_zero": int(row[9]),
            "max_abs_difference_not_filled": row[10],
        }

    return {
        "climatology": {
            "n_compared": int(climatology[0]),
            "n_only_on_one_side": int(climatology[1]),
            "max_relative_difference": climatology[2],
            "n_year_count_differs": int(climatology[3]),
        },
        "anomalies_vs_python": {
            "n_compared": int(anomalies[0]),
            "n_python_anomalies": int(anomalies[4]),
            "n_differs_beyond_1e-9": int(anomalies[2]),
            "max_relative_difference": anomalies[3],
        },
        "filled_month_index_axis": fill("false"),
        "filled_calendar_time_axis": fill("true"),
    }


def _vector(text: str) -> np.ndarray:
    return np.array(json.loads(text), dtype=float)


def check_vector(
    conn: psycopg.Connection[Any], sample: int = 50, k: int = 10
) -> dict[str, Any]:
    """cosine 相似度對照 numpy 算的 Pearson 相關；HNSW 索引的前 k 名對照逐一比對的前 k 名。"""
    n = int(_one(conn, "SELECT count(*) FROM analysis.series_embeddings")[0])
    eligible = _one(
        conn,
        "SELECT count(*), count(*) FILTER (WHERE q.mining_eligible) FROM clean.series_summary q",
    )
    if n == 0:
        return {"n_embeddings": 0}
    ids = [
        row[0]
        for row in conn.execute(
            "SELECT series_id FROM analysis.series_embeddings ORDER BY series_id"
        )
    ]
    picked = ids[:: max(1, len(ids) // sample)][:sample]
    worst = 0.0
    recalled = total = 0
    for series_id in picked:
        target = _vector(
            _one(
                conn,
                "SELECT embedding::text FROM analysis.series_embeddings WHERE series_id = %s",
                series_id,
            )[0]
        )
        # 距平本身（補值後、未標準化）的 Pearson 相關，由 numpy 另外算
        own = np.array(
            [
                row[0]
                for row in conn.execute(
                    "SELECT anomaly_filled FROM clean.observations WHERE series_id = %s"
                    " AND month BETWEEN %s AND %s ORDER BY month",
                    (series_id, *EMBEDDING_WINDOW),
                )
            ]
        )
        with conn.transaction():
            conn.execute("SET LOCAL enable_seqscan = off")
            indexed = conn.execute(
                "SELECT series_id, cosine_similarity FROM analysis.similar_series(%s, %s)",
                (series_id, k),
            ).fetchall()
        with conn.transaction():
            conn.execute("SET LOCAL enable_indexscan = off")
            conn.execute("SET LOCAL enable_bitmapscan = off")
            exact = conn.execute(
                "SELECT e.series_id FROM analysis.series_embeddings e WHERE e.series_id <> %s"
                " ORDER BY e.embedding <=> %s::vector, e.series_id LIMIT %s",
                (series_id, json.dumps(target.tolist()), k),
            ).fetchall()
        recalled += len({r[0] for r in indexed} & {r[0] for r in exact})
        total += len(exact)
        for other, similarity in indexed[:3]:
            theirs = np.array(
                [
                    row[0]
                    for row in conn.execute(
                        "SELECT anomaly_filled FROM clean.observations WHERE series_id = %s"
                        " AND month BETWEEN %s AND %s ORDER BY month",
                        (other, *EMBEDDING_WINDOW),
                    )
                ]
            )
            worst = max(worst, abs(float(np.corrcoef(own, theirs)[0, 1]) - similarity))
    return {
        "n_series": int(eligible[0]),
        "n_mining_eligible": int(eligible[1]),
        "n_embeddings": n,
        "n_query_series": len(picked),
        "k": k,
        "hnsw_recall_at_k": recalled / total if total else None,
        "max_abs_difference_cosine_vs_numpy_pearson": worst,
    }


def check_ltree(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    row = _one(
        conn,
        "SELECT count(*), count(category_path),"
        " count(*) FILTER (WHERE category_basis = 'manual'),"
        " count(*) FILTER (WHERE category_basis LIKE 'rule:%%'),"
        " count(*) FILTER (WHERE category_basis = 'unclassified'),"
        " count(*) FILTER (WHERE is_auxiliary),"
        " count(*) FILTER (WHERE is_auxiliary AND category_path <@ 'auxiliary'),"
        " count(*) FILTER (WHERE NOT is_auxiliary AND category_path <@ 'auxiliary')"
        " FROM meta.variables",
    )
    return {
        "n_variables": int(row[0]),
        "n_with_category": int(row[1]),
        "n_manual": int(row[2]),
        "n_by_rule": int(row[3]),
        "n_unclassified": int(row[4]),
        "n_is_auxiliary": int(row[5]),
        "n_is_auxiliary_under_auxiliary": int(row[6]),
        "n_under_auxiliary_but_not_is_auxiliary": int(row[7]),
        "n_tree_nodes": int(_one(conn, "SELECT count(*) FROM meta.category_tree")[0]),
    }


def components(nodes: list[int], edges: list[tuple[int, int]]) -> dict[int, int]:
    """連通分量（union-find）：節點 → 分量裡最小的節點編號。用來對照 pgr_connectedComponents。"""
    parent = {node: node for node in nodes}

    def find(node: int) -> int:
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for a, b in edges:
        root_a, root_b = find(a), find(b)
        if root_a != root_b:
            parent[max(root_a, root_b)] = min(root_a, root_b)
    return {node: find(node) for node in nodes}


def check_pgrouting(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    nodes = conn.execute(
        "SELECT node_id, component FROM analysis.variable_graph_nodes ORDER BY 1"
    ).fetchall()
    edges = conn.execute(
        "SELECT source, target FROM analysis.variable_graph"
    ).fetchall()
    expected = components([n[0] for n in nodes], [(e[0], e[1]) for e in edges])
    return {
        "n_nodes": len(nodes),
        "n_edges": len(edges),
        "n_components": len({n[1] for n in nodes}),
        "n_nodes_component_differs_from_union_find": sum(
            1 for node, component in nodes if expected[node] != component
        ),
    }


def check_tablefunc(
    conn: psycopg.Connection[Any], analysis_dir: Path
) -> dict[str, Any]:
    """crosstab 的寬表對照 `mining.build_table`（同樣的補值設定）逐格比對。"""
    anomalies_path, trends_path = (
        analysis_dir / "anomalies.json",
        analysis_dir / "trends.json",
    )
    if not anomalies_path.exists() or not trends_path.exists():
        return {"skipped": f"{analysis_dir} 沒有 anomalies.json 或 trends.json"}
    anomalies = json.loads(anomalies_path.read_text(encoding="utf-8"))
    trends = json.loads(trends_path.read_text(encoding="utf-8"))
    result: dict[str, Any] = {}
    for kind in ("point", "region"):
        table = mining.build_table(anomalies, trends, kind, mining.MiningParams())
        exists = _one(
            conn, "SELECT to_regclass(%s) IS NOT NULL", f"analysis.mining_wide_{kind}"
        )
        if not exists[0]:
            result[kind] = {"skipped": "還沒有寬表；先跑 pg derive"}
            continue
        cursor = conn.execute(
            _sql(
                f"SELECT * FROM analysis.mining_wide_{kind} ORDER BY location_id, month"
            )
        )
        assert cursor.description is not None
        names = [column.name for column in cursor.description]
        stored = {(row[0], row[1].isoformat()): row[2:] for row in cursor.fetchall()}
        months = [index_month(table.first_index + i) for i in range(table.n_months)]
        n_cells = n_value = n_null_mismatch = 0
        worst = 0.0
        for location in table.locations:
            for position, month in enumerate(months):
                row = stored.get((location, month))
                for column, variable in enumerate(names[2:]):
                    series = table.values[location].get(variable)
                    ours = float("nan") if series is None else float(series[position])
                    theirs = None if row is None else row[column]
                    n_cells += 1
                    if math.isnan(ours) != (theirs is None):
                        n_null_mismatch += 1
                    elif theirs is not None:
                        n_value += 1
                        worst = max(worst, abs(ours - theirs) / max(abs(ours), 1e-300))
        result[kind] = {
            "python_shape": [
                len(table.locations) * table.n_months,
                len(table.variables),
            ],
            "sql_shape": [len(stored), len(names) - 2],
            "same_variables": sorted(table.variables) == sorted(names[2:]),
            "same_months": sorted({key[1] for key in stored}) == months,
            "n_cells": n_cells,
            "n_values_compared": n_value,
            "n_null_pattern_differs": n_null_mismatch,
            "max_relative_difference": worst,
        }
    return result


def check_mann_kendall(
    conn: psycopg.Connection[Any], every: int = 30
) -> dict[str, Any]:
    """plpython3u 的原始 MK 與 Sen 斜率，對照結果檔（pymannkendall、scipy）寫回 `analysis.trends` 的值。"""
    rows = conn.execute(
        "SELECT t.series_id, (t.result #>> '{mann_kendall,original,z}')::float8,"
        " t.mk_original_p, (t.result #>> '{mann_kendall,original,tau}')::float8,"
        " t.sen_slope_per_decade, t.n_valid, m.n, m.z, m.p, m.tau, m.sen_slope_per_decade"
        " FROM analysis.trends t JOIN meta.series s USING (series_id)"
        " CROSS JOIN LATERAL analysis.mann_kendall(t.series_id) m"
        " WHERE t.status = 'analyzed' AND (s.tier = 'core' OR t.series_id %% %s = 0)",
        (every,),
    ).fetchall()

    def worst(a: int, b: int, relative: bool = False) -> float | None:
        differences = [
            abs(r[a] - r[b]) / (max(abs(r[a]), 1e-12) if relative else 1.0)
            for r in rows
            if r[a] is not None and r[b] is not None
        ]
        return max(differences, default=None)

    return {
        "n_series_compared": len(rows),
        "n_series_n_differs": sum(1 for r in rows if r[5] != r[6]),
        "max_abs_difference_z": worst(1, 7),
        "max_abs_difference_p": worst(2, 8),
        "max_abs_difference_tau": worst(3, 9),
        "max_relative_difference_sen_slope": worst(4, 10, relative=True),
    }


def check_file_fdw(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    try:
        with conn.transaction():
            row = _one(conn, "SELECT * FROM raw.check_file_planetary_computer()")
    except psycopg.Error as error:
        return {"skipped": f"讀不到原檔（{str(error).strip().splitlines()[0]}）"}
    return {
        "n_rows_in_files": int(row[0]),
        "n_rows_loaded": int(row[1]),
        "n_only_in_file": int(row[2]),
        "n_only_loaded": int(row[3]),
        "n_value_differs": int(row[4]),
        "max_abs_difference": row[5],
    }


def check_pg_cron(conn: psycopg.Connection[Any]) -> dict[str, Any]:
    if not _one(conn, "SELECT count(*) FROM pg_extension WHERE extname = 'pg_cron'")[0]:
        return {"enabled": False}
    jobs = conn.execute(
        "SELECT jobname, schedule, command, active FROM cron.job ORDER BY jobid"
    ).fetchall()
    return {
        "enabled": True,
        "jobs": [
            {"jobname": j[0], "schedule": j[1], "command": j[2], "active": j[3]}
            for j in jobs
        ],
    }


def run_checks(conn: psycopg.Connection[Any], analysis_dir: Path) -> dict[str, Any]:
    return {
        "postgis_raster": check_raster(conn),
        "postgis_raster_monthly": check_monthly_rasters(conn),
        "ltree": check_ltree(conn),
        "vector": check_vector(conn),
        "h3": check_h3(conn),
        "timescaledb_toolkit": check_toolkit(conn),
        "pgrouting": check_pgrouting(conn),
        "tablefunc": check_tablefunc(conn, analysis_dir),
        "plpython3u": check_mann_kendall(conn),
        "pg_textsearch": {
            "n_documents": int(
                _one(conn, "SELECT count(*) FROM meta.search_documents")[0]
            )
        },
        "file_fdw": check_file_fdw(conn),
        "pg_cron": check_pg_cron(conn),
    }
