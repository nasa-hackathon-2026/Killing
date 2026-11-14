"""把快照與各來源的原始回應整理成一個 SQLite 檔（#26）。

用法（在 repo 根目錄）：
    uv run python -m trend_detective.sqlite_export

表：
    observations     統一表：每列是 變數 × 地點 × 聚合方式 × 月份，內容與 data/snapshot/ 的序列檔相同
    series           每條序列的來源、查詢參數與它對應的來源表（source_table）
    variables、locations   目錄檔的對照表
    src_giovanni     Giovanni 單點的原始時間粒度（月或日）
    src_harmony      Harmony 區域平均的原始時間粒度
    src_nasa_power   NASA POWER 的原始鍵（含年平均鍵 YYYY13）
    src_noaa_ghcnh   測站當地日的日平均與觀測筆數（逐時原始值不收）
    src_appeears     AppEEARS（MODIS）每個合成期的區域統計量：平均、標準差、像元數…
    src_planetary_computer   Planetary Computer（MODIS）每個合成期的區域統計量，本機算出
    src_grid         全球格點立方體在本機算出的區域面積加權月平均（`aggregation = 'area_mean_grid'`）：
                     月值、有值面積比例，以及用的立方體、bbox、網格間距、格子數（立方體本身不進資料庫）
    trends           每條序列的趨勢統計（#55、#68）：每十年變化量、信賴區間、各檢定的 p 與 FDR 校正後的 q、
                     分析期間、有效月數；沒有分析的序列 `status = 'insufficient'` 並附原因。
                     來源是 `data/analysis/trends.json`（核心）與 `data/extended/analysis/trends.json`（擴充），
                     沒有這兩個檔時是空表。q 的校正範圍記在 `fdr_scope`（核心：整批；擴充：同一種聚合方式）。

查「哪些變數在哪些地點顯著」（自相關修正後的 t 檢定，FDR 校正後）：
    SELECT variable_id, location_id, aggregation, slope_per_decade, ci_low_per_decade,
           ci_high_per_decade, ols_p, ols_q
    FROM trends WHERE ols_significant_fdr = 1 ORDER BY ols_q;

`observations`、`series`、`variables`、`locations` 都有 `tier` 欄：`core` 是進 git 的核心快照
（`data/snapshot/`），`extended` 是擴充資料（`data/extended/`，#46；這台機器沒有就只有核心）。
只看核心：`WHERE tier = 'core'`。

來源表都有 (variable_id, location_id)，可以對回 observations 與 series。
公開 demo 只讀靜態 JSON，不讀這個檔；它是給隊員與評審用 SQL 查的。
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from trend_detective import ghcnh, planetary_computer
from trend_detective.extended import EXTENDED_DIR
from trend_detective.giovanni import parse_timeseries_csv
from trend_detective.harmony import parse_area_csv
from trend_detective.snapshot import (
    RAW_DIR,
    SNAPSHOT_DIR,
    STATION_UTC_OFFSET_HOURS,
    appeears_rows,
)
from trend_detective.trends import ANALYSIS_DIR

DB_PATH = Path("data/sqlite/trend_detective.sqlite")
SOURCE_TABLES = {
    "giovanni": "src_giovanni",
    "harmony": "src_harmony",
    "nasa_power": "src_nasa_power",
    "noaa_ghcnh": "src_noaa_ghcnh",
    "appeears": "src_appeears",
    "planetary_computer": "src_planetary_computer",
    "grid": "src_grid",
}

SCHEMA = """
CREATE TABLE variables (
    id TEXT PRIMARY KEY, name_zh TEXT, name_en TEXT, definition_zh TEXT, category TEXT,
    unit TEXT, source TEXT, source_variable_id TEXT, product_version TEXT,
    native_temporal_res TEXT, valid_from TEXT, valid_to TEXT, is_nasa INTEGER,
    note_zh TEXT, citation TEXT, doi TEXT,
    tier TEXT NOT NULL, product TEXT, needs_translation INTEGER NOT NULL
);
CREATE TABLE locations (
    id TEXT PRIMARY KEY, kind TEXT, name_zh TEXT, name_en TEXT, lat REAL, lon REAL,
    bbox_w REAL, bbox_s REAL, bbox_e REAL, bbox_n REAL, geojson TEXT, ghcnh_id TEXT,
    tier TEXT NOT NULL
);
CREATE TABLE series (
    variable_id TEXT NOT NULL REFERENCES variables(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    aggregation TEXT NOT NULL, source_api TEXT, source_table TEXT, unit TEXT,
    product_version TEXT, retrieved_at TEXT, request_json TEXT,
    grid_lat REAL, grid_lon REAL, n_points INTEGER, first_month TEXT, last_month TEXT,
    tier TEXT NOT NULL,
    PRIMARY KEY (variable_id, location_id, aggregation)
);
CREATE TABLE observations (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, aggregation TEXT NOT NULL,
    month TEXT NOT NULL, value REAL, n_samples INTEGER, coverage REAL,
    unit TEXT, source_api TEXT, tier TEXT NOT NULL,
    PRIMARY KEY (variable_id, location_id, aggregation, month),
    FOREIGN KEY (variable_id, location_id, aggregation)
        REFERENCES series(variable_id, location_id, aggregation)
);
CREATE TABLE src_giovanni (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, timestamp TEXT NOT NULL,
    value REAL, unit TEXT, grid_lat REAL, grid_lon REAL,
    PRIMARY KEY (variable_id, location_id, timestamp)
);
CREATE TABLE src_harmony (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, timestamp TEXT NOT NULL,
    value REAL, source_column TEXT, bbox_w REAL, bbox_s REAL, bbox_e REAL, bbox_n REAL,
    PRIMARY KEY (variable_id, location_id, timestamp)
);
CREATE TABLE src_nasa_power (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, period TEXT NOT NULL,
    is_annual_mean INTEGER NOT NULL, value REAL, unit TEXT,
    PRIMARY KEY (variable_id, location_id, period)
);
CREATE TABLE src_noaa_ghcnh (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, station_id TEXT NOT NULL,
    local_date TEXT NOT NULL, mean_temp_c REAL, n_obs INTEGER,
    PRIMARY KEY (variable_id, location_id, local_date)
);
CREATE TABLE src_appeears (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, date TEXT NOT NULL,
    dataset TEXT, pixel_count INTEGER, mean REAL, standard_deviation REAL,
    minimum REAL, maximum REAL, median REAL,
    PRIMARY KEY (variable_id, location_id, date)
);
CREATE TABLE src_planetary_computer (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, date TEXT NOT NULL,
    asset TEXT, pixel_count INTEGER, mean REAL, standard_deviation REAL,
    minimum REAL, maximum REAL, pixels_in_bbox INTEGER, tiles TEXT, item_ids TEXT,
    PRIMARY KEY (variable_id, location_id, date)
);
CREATE TABLE src_grid (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, month TEXT NOT NULL,
    value REAL, coverage REAL, cube_id TEXT, product TEXT, source_variable TEXT,
    bbox_w REAL, bbox_s REAL, bbox_e REAL, bbox_n REAL,
    lat_step REAL, lon_step REAL, n_cells INTEGER, weights TEXT,
    PRIMARY KEY (variable_id, location_id, month)
);
CREATE TABLE trends (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, aggregation TEXT NOT NULL,
    tier TEXT NOT NULL, unit TEXT, status TEXT NOT NULL,
    reason_code TEXT, reason_text TEXT,
    first_month TEXT, last_month TEXT, n_points INTEGER, n_valid INTEGER,
    n_null INTEGER, n_low_coverage INTEGER, missing_fraction REAL,
    slope_per_decade REAL, ci_low_per_decade REAL, ci_high_per_decade REAL,
    ols_p REAL, ols_q REAL, ols_significant INTEGER, ols_significant_fdr INTEGER,
    ols_p_uncorrected REAL, lag1_autocorrelation REAL, n_effective REAL,
    mk_original_p REAL, mk_original_q REAL, mk_original_tau REAL,
    mk_hamed_rao_p REAL, mk_hamed_rao_q REAL,
    mk_seasonal_p REAL, mk_seasonal_q REAL, mk_seasonal_slope_per_decade REAL,
    sen_slope_per_decade REAL, sen_ci_low_per_decade REAL, sen_ci_high_per_decade REAL,
    alpha REAL, fdr_scope TEXT, fdr_n_series INTEGER,
    PRIMARY KEY (variable_id, location_id, aggregation),
    FOREIGN KEY (variable_id, location_id, aggregation)
        REFERENCES series(variable_id, location_id, aggregation)
);
CREATE INDEX trends_by_significance ON trends(ols_significant_fdr, aggregation);
CREATE INDEX observations_by_month ON observations(month);
CREATE INDEX observations_by_tier ON observations(tier);
"""


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build_database(
    snapshot_dir: Path,
    raw_dir: Path,
    db_path: Path,
    extended_dir: Path | None = None,
    analysis_dir: Path | None = None,
) -> dict[str, int]:
    """從快照與原始回應重建整個 SQLite 檔，回傳各表的列數。

    `extended_dir` 有目錄檔時，擴充資料（#46）一併匯入同一組表，`tier` 欄記成 `extended`；
    核心快照已有的變數與地點以核心為準。

    `trends` 表（#68）由 `analysis_dir/trends.json`（核心）與
    `extended_dir/analysis/trends.json`（擴充）填入；檔案不在就略過。

    每次都從頭建到暫存檔再換上去，所以重建是冪等的，中斷也不會留下半個資料庫。
    某來源的原始檔不在（例如別台機器只有快照）時，該來源表留空，統一表不受影響。
    """
    catalog = _load(snapshot_dir / "catalog.json")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    partial = db_path.with_suffix(db_path.suffix + ".part")
    partial.unlink(missing_ok=True)
    db = sqlite3.connect(partial)
    try:
        db.executescript(SCHEMA)
        _insert_lookups(db, catalog, "core")
        all_series = [
            _load(snapshot_dir / entry["file"]) for entry in catalog["series"]
        ]
        _insert_series(db, all_series, "core")
        if extended_dir is not None and (extended_dir / "catalog.json").exists():
            extended = _load(extended_dir / "catalog.json")
            _insert_lookups(db, extended, "extended")
            core_keys = {
                (s["variable_id"], s["location_id"], s["aggregation"])
                for s in all_series
            }
            extra = [
                _load(extended_dir / entry["file"])
                for entry in extended["series"]
                if (entry["variable_id"], entry["location_id"], entry["aggregation"])
                not in core_keys
            ]
            _insert_series(db, extra, "extended")
            all_series += extra
        _insert_giovanni(db, all_series, raw_dir / "giovanni")
        _insert_harmony(db, all_series, raw_dir / "harmony")
        _insert_power(db, all_series, raw_dir / "power")
        _insert_ghcnh(db, all_series, raw_dir / "ghcnh")
        _insert_appeears(db, catalog, all_series, raw_dir / "appeears")
        _insert_planetary_computer(
            db, all_series, raw_dir / planetary_computer.SOURCE_DIR
        )
        _insert_grid(db, all_series)
        if analysis_dir is not None:
            _insert_trends(db, analysis_dir / "trends.json", "core")
        if extended_dir is not None:
            _insert_trends(db, extended_dir / "analysis" / "trends.json", "extended")
        violations = db.execute("PRAGMA foreign_key_check").fetchall()
        if violations:
            raise ValueError(f"資料庫的外鍵對不上：{violations[:5]}")
        db.commit()
        tables = [
            "variables",
            "locations",
            "series",
            "observations",
            *SOURCE_TABLES.values(),
            "trends",
        ]
        counts = {
            table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in tables
        }
    finally:
        db.close()
    partial.replace(db_path)
    return counts


def series_without_source_rows(db_path: Path) -> list[tuple[str, str, str]]:
    """列出來源表裡沒有任何列的序列（原始檔不在這台機器上時會發生）。"""
    missing: list[tuple[str, str, str]] = []
    db = sqlite3.connect(db_path)
    try:
        rows = db.execute(
            "SELECT variable_id, location_id, aggregation, source_table FROM series ORDER BY 1, 2, 3"
        ).fetchall()
        for variable_id, location_id, aggregation, table in rows:
            if table not in SOURCE_TABLES.values():
                missing.append((variable_id, location_id, aggregation))
                continue
            found = db.execute(
                f"SELECT 1 FROM {table} WHERE variable_id = ? AND location_id = ? LIMIT 1",
                (variable_id, location_id),
            ).fetchone()
            if found is None:
                missing.append((variable_id, location_id, aggregation))
    finally:
        db.close()
    return missing


def _insert_lookups(db: sqlite3.Connection, catalog: dict[str, Any], tier: str) -> None:
    """已經在表裡的變數與地點不覆蓋（先匯入核心，所以兩邊都有時以核心為準）。"""
    for v in catalog["variables"]:
        db.execute(
            "INSERT OR IGNORE INTO variables VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                v["id"],
                v.get("name_zh"),
                v.get("name_en"),
                v.get("definition_zh"),
                v.get("category"),
                v.get("unit"),
                v.get("source"),
                v.get("source_variable_id"),
                v.get("product_version"),
                v.get("native_temporal_res"),
                v.get("valid_from"),
                v.get("valid_to"),
                int(bool(v.get("is_nasa"))),
                v.get("note_zh"),
                v.get("citation"),
                v.get("doi"),
                tier,
                v.get("product"),
                int(bool(v.get("needs_translation"))),
            ),
        )
    for loc in catalog["locations"]:
        bbox = loc.get("bbox") or [None] * 4
        db.execute(
            "INSERT OR IGNORE INTO locations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                loc["id"],
                loc.get("kind"),
                loc.get("name_zh"),
                loc.get("name_en"),
                loc.get("lat"),
                loc.get("lon"),
                *bbox,
                json.dumps(loc["geojson"], ensure_ascii=False)
                if "geojson" in loc
                else None,
                loc.get("ghcnh_id"),
                tier,
            ),
        )


def _insert_series(
    db: sqlite3.Connection, all_series: list[dict[str, Any]], tier: str
) -> None:
    for s in all_series:
        key = (s["variable_id"], s["location_id"], s["aggregation"])
        months = [p["month"] for p in s["points"]]
        grid = s.get("grid") or {}
        db.execute(
            "INSERT INTO series VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                *key,
                s["source_api"],
                SOURCE_TABLES.get(s["source_api"]),
                s["unit"],
                s["product_version"],
                s["retrieved_at"],
                json.dumps(s["request"], ensure_ascii=False, sort_keys=True),
                grid.get("lat"),
                grid.get("lon"),
                len(months),
                min(months) if months else None,
                max(months) if months else None,
                tier,
            ),
        )
        db.executemany(
            "INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    *key,
                    p["month"],
                    p["value"],
                    p["n_samples"],
                    p["coverage"],
                    s["unit"],
                    s["source_api"],
                    tier,
                )
                for p in s["points"]
            ],
        )


def _of(all_series: list[dict[str, Any]], source_api: str) -> list[dict[str, Any]]:
    return [s for s in all_series if s["source_api"] == source_api]


def _insert_giovanni(
    db: sqlite3.Connection, all_series: list[dict[str, Any]], raw: Path
) -> None:
    for s in _of(all_series, "giovanni"):
        path = raw / f"{s['variable_id']}__{s['location_id']}.csv"
        if not path.exists():
            continue
        parsed = parse_timeseries_csv(path.read_text(encoding="utf-8"))
        db.executemany(
            "INSERT INTO src_giovanni VALUES (?,?,?,?,?,?,?)",
            [
                (
                    s["variable_id"],
                    s["location_id"],
                    day.isoformat(),
                    value,
                    parsed.unit,
                    parsed.grid_lat,
                    parsed.grid_lon,
                )
                for day, value in parsed.rows
            ],
        )


def _insert_harmony(
    db: sqlite3.Connection, all_series: list[dict[str, Any]], raw: Path
) -> None:
    for s in _of(all_series, "harmony"):
        path = raw / f"{s['variable_id']}__{s['location_id']}.csv"
        if not path.exists():
            continue
        parsed = parse_area_csv(path.read_text(encoding="utf-8"))
        db.executemany(
            "INSERT INTO src_harmony VALUES (?,?,?,?,?,?,?,?,?)",
            [
                (
                    s["variable_id"],
                    s["location_id"],
                    day.isoformat(),
                    value,
                    parsed.column,
                    *(parsed.bbox if len(parsed.bbox) == 4 else [None] * 4),
                )
                for day, value in parsed.rows
            ],
        )


def _insert_power(
    db: sqlite3.Connection, all_series: list[dict[str, Any]], raw: Path
) -> None:
    for s in _of(all_series, "nasa_power"):
        path = raw / f"{s['variable_id']}__{s['location_id']}.json"
        if not path.exists():
            continue
        payload = _load(path)
        parameter = s["request"]["parameters"]
        fill = float((payload.get("header") or {}).get("fill_value", -999.0))
        unit = ((payload.get("parameters") or {}).get(parameter) or {}).get("units")
        values = payload["properties"]["parameter"][parameter]
        db.executemany(
            "INSERT INTO src_nasa_power VALUES (?,?,?,?,?,?)",
            [
                (
                    s["variable_id"],
                    s["location_id"],
                    period,
                    int(period[4:6] == "13"),
                    None
                    if raw_value is None or float(raw_value) == fill
                    else float(raw_value),
                    unit,
                )
                for period, raw_value in sorted(values.items())
            ],
        )


def _insert_ghcnh(
    db: sqlite3.Connection, all_series: list[dict[str, Any]], raw: Path
) -> None:
    for s in _of(all_series, "noaa_ghcnh"):
        station_id = s["request"]["station"]
        hourly: list[ghcnh.Hourly] = []
        for path in sorted(raw.glob(f"GHCNh_{station_id}_*.psv")):
            hourly.extend(ghcnh.parse_psv(path.read_text(encoding="utf-8")))
        offset = s["request"].get(
            "local_day_utc_offset_hours", STATION_UTC_OFFSET_HOURS
        )
        db.executemany(
            "INSERT INTO src_noaa_ghcnh VALUES (?,?,?,?,?,?)",
            [
                (
                    s["variable_id"],
                    s["location_id"],
                    station_id,
                    day.isoformat(),
                    mean,
                    n_obs,
                )
                for day, mean, n_obs in ghcnh.hourly_to_daily(
                    hourly, utc_offset_hours=offset
                )
            ],
        )


def _insert_appeears(
    db: sqlite3.Connection,
    catalog: dict[str, Any],
    all_series: list[dict[str, Any]],
    raw: Path,
) -> None:
    """每個合成期的區域統計量（平均、標準差、像元數…），原始時間粒度。"""
    variables = {v["id"]: v for v in catalog["variables"]}
    wanted = {(s["variable_id"], s["location_id"]) for s in _of(all_series, "appeears")}
    for variable_id in sorted({key[0] for key in wanted}):
        if not any((raw / variable_id).glob("*/submission.json")):
            continue  # 這台機器沒有 AppEEARS 的原始檔：來源表留空
        rows_by_region, _ = appeears_rows(raw / variable_id, variables[variable_id])
        for location_id, rows in sorted(rows_by_region.items()):
            if (variable_id, location_id) not in wanted:
                continue
            db.executemany(
                "INSERT INTO src_appeears VALUES (?,?,?,?,?,?,?,?,?,?)",
                [
                    (
                        variable_id,
                        location_id,
                        row.day.isoformat(),
                        row.dataset,
                        row.count,
                        row.mean,
                        row.standard_deviation,
                        row.minimum,
                        row.maximum,
                        row.median,
                    )
                    for row in rows
                ],
            )


def _insert_planetary_computer(
    db: sqlite3.Connection, all_series: list[dict[str, Any]], raw: Path
) -> None:
    """每個合成期的區域統計量，以及用到的 tile 與 item（`stats.csv` 的內容）。"""
    for s in _of(all_series, "planetary_computer"):
        path = raw / s["variable_id"] / planetary_computer.STATS_FILE
        if not path.exists():
            continue  # 這台機器沒有原始統計檔：來源表留空

        def number(text: str) -> float | None:
            return float(text) if text else None

        db.executemany(
            "INSERT INTO src_planetary_computer VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    s["variable_id"],
                    s["location_id"],
                    row["date"],
                    row["asset"],
                    int(row["count"]),
                    number(row["mean"]),
                    number(row["standard_deviation"]),
                    number(row["minimum"]),
                    number(row["maximum"]),
                    int(row["pixels_in_bbox"]),
                    row["tiles"],
                    row["item_ids"],
                )
                for (_, location_id), row in sorted(
                    planetary_computer.read_stats(path).items()
                )
                if location_id == s["location_id"]
                and row["asset"] == s["request"]["asset"]
            ],
        )


def _insert_grid(db: sqlite3.Connection, all_series: list[dict[str, Any]]) -> None:
    """格點算出的區域平均（#64）。來源是序列檔自己：立方體太大，不進資料庫。"""
    for s in _of(all_series, "grid"):
        request = s["request"]
        cells = request.get("grid") or {}
        db.executemany(
            "INSERT INTO src_grid VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            [
                (
                    s["variable_id"],
                    s["location_id"],
                    p["month"],
                    p["value"],
                    p["coverage"],
                    request.get("cube_id"),
                    request.get("product"),
                    request.get("variable"),
                    *(request.get("bbox") or [None] * 4),
                    cells.get("lat_step"),
                    cells.get("lon_step"),
                    request.get("n_cells"),
                    request.get("weights"),
                )
                for p in s["points"]
            ],
        )


def _insert_trends(db: sqlite3.Connection, path: Path, tier: str) -> None:
    """趨勢結果檔（`trends.py` 的輸出）攤平成一列一條序列。

    只收 `series` 表裡同一個 `tier` 的序列：擴充目錄裡與核心重複的序列以核心為準，
    結果檔比序列檔舊、對不到序列的也不收。
    """
    if not path.exists():
        return
    content = _load(path)
    alpha = content["parameters"]["alpha"]
    group_by = (content.get("fdr") or {}).get("group_by", "all")
    group_sizes = (content.get("fdr") or {}).get("n_series_by_group") or {}
    known = {
        tuple(row)
        for row in db.execute(
            "SELECT variable_id, location_id, aggregation FROM series WHERE tier = ?",
            (tier,),
        )
    }

    def flag(value: Any) -> int | None:
        return None if value is None else int(bool(value))

    rows = []
    for item in content["series"].values():
        key = (item["variable_id"], item["location_id"], item["aggregation"])
        if key not in known:
            continue
        data = item["data"]
        reason = item.get("reason") or {}
        ols = item.get("ols") or {}
        mk = item.get("mann_kendall") or {}
        original = mk.get("original") or {}
        hamed_rao = mk.get("hamed_rao") or {}
        seasonal = mk.get("seasonal") or {}
        sen = item.get("sen") or {}
        ci = ols.get("ci_per_decade") or [None, None]
        sen_ci = sen.get("ci_per_decade") or [None, None]
        scope = (
            "all series of the run"
            if group_by == "all"
            else f"{group_by} = {item[group_by]}"
        )
        n_scope = (
            len(content["series"])
            if group_by == "all"
            else group_sizes.get(item[group_by])
        )
        rows.append(
            (
                *key,
                tier,
                item.get("unit"),
                item["status"],
                reason.get("code"),
                reason.get("text_en"),
                data.get("first_month"),
                data.get("last_month"),
                data.get("n_points"),
                data.get("n_valid"),
                data.get("n_null"),
                data.get("n_low_coverage"),
                data.get("missing_fraction"),
                ols.get("slope_per_decade"),
                ci[0],
                ci[1],
                ols.get("p"),
                ols.get("p_fdr"),
                flag(ols.get("significant")),
                flag(ols.get("significant_fdr")),
                ols.get("p_uncorrected"),
                ols.get("lag1_autocorrelation"),
                ols.get("n_effective"),
                original.get("p"),
                original.get("p_fdr"),
                original.get("tau"),
                hamed_rao.get("p"),
                hamed_rao.get("p_fdr"),
                seasonal.get("p"),
                seasonal.get("p_fdr"),
                seasonal.get("slope_per_decade"),
                sen.get("slope_per_decade"),
                sen_ci[0],
                sen_ci[1],
                alpha,
                scope,
                n_scope,
            )
        )
    db.executemany(f"INSERT INTO trends VALUES ({','.join('?' * 39)})", rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="從快照與原始回應重建 SQLite 檔")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    parser.add_argument(
        "--extended-dir",
        type=Path,
        default=EXTENDED_DIR,
        help="擴充資料的目錄（#46）；沒有目錄檔就只匯入核心",
    )
    parser.add_argument(
        "--analysis-dir",
        type=Path,
        default=ANALYSIS_DIR,
        help="核心趨勢結果（trends.json）的目錄；擴充的在 <extended-dir>/analysis/",
    )
    args = parser.parse_args(argv)
    counts = build_database(
        args.snapshot_dir, args.raw_dir, args.db, args.extended_dir, args.analysis_dir
    )
    print(args.db)
    for table, count in counts.items():
        print(f"  {table:<16} {count:>8}")
    db = sqlite3.connect(args.db)
    for tier, n_series, n_rows in db.execute(
        "SELECT s.tier, COUNT(DISTINCT s.variable_id || s.location_id || s.aggregation),"
        " COUNT(o.month) FROM series s LEFT JOIN observations o USING"
        " (variable_id, location_id, aggregation) GROUP BY s.tier"
    ):
        print(f"  tier = {tier}：{n_series} 條序列，{n_rows} 列 observations")
    db.close()
    missing = series_without_source_rows(args.db)
    if missing:
        print(
            f"有 {len(missing)} 條序列在來源表裡沒有資料（{args.raw_dir} 缺原始檔），統一表不受影響："
        )
        for variable_id, location_id, aggregation in missing[:20]:
            print(f"  {variable_id} @ {location_id}（{aggregation}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
