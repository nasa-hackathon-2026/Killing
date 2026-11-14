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

來源表都有 (variable_id, location_id)，可以對回 observations 與 series。
公開 demo 只讀靜態 JSON，不讀這個檔；它是給隊員與評審用 SQL 查的。
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

from trend_detective import ghcnh
from trend_detective.giovanni import parse_timeseries_csv
from trend_detective.harmony import parse_area_csv
from trend_detective.snapshot import RAW_DIR, SNAPSHOT_DIR, STATION_UTC_OFFSET_HOURS

DB_PATH = Path("data/sqlite/trend_detective.sqlite")
SOURCE_TABLES = {
    "giovanni": "src_giovanni",
    "harmony": "src_harmony",
    "nasa_power": "src_nasa_power",
    "noaa_ghcnh": "src_noaa_ghcnh",
}

SCHEMA = """
CREATE TABLE variables (
    id TEXT PRIMARY KEY, name_zh TEXT, name_en TEXT, definition_zh TEXT, category TEXT,
    unit TEXT, source TEXT, source_variable_id TEXT, product_version TEXT,
    native_temporal_res TEXT, valid_from TEXT, valid_to TEXT, is_nasa INTEGER,
    note_zh TEXT, citation TEXT, doi TEXT
);
CREATE TABLE locations (
    id TEXT PRIMARY KEY, kind TEXT, name_zh TEXT, name_en TEXT, lat REAL, lon REAL,
    bbox_w REAL, bbox_s REAL, bbox_e REAL, bbox_n REAL, geojson TEXT, ghcnh_id TEXT
);
CREATE TABLE series (
    variable_id TEXT NOT NULL REFERENCES variables(id),
    location_id TEXT NOT NULL REFERENCES locations(id),
    aggregation TEXT NOT NULL, source_api TEXT, source_table TEXT, unit TEXT,
    product_version TEXT, retrieved_at TEXT, request_json TEXT,
    grid_lat REAL, grid_lon REAL, n_points INTEGER, first_month TEXT, last_month TEXT,
    PRIMARY KEY (variable_id, location_id, aggregation)
);
CREATE TABLE observations (
    variable_id TEXT NOT NULL, location_id TEXT NOT NULL, aggregation TEXT NOT NULL,
    month TEXT NOT NULL, value REAL, n_samples INTEGER, coverage REAL,
    unit TEXT, source_api TEXT,
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
    value REAL,
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
CREATE INDEX observations_by_month ON observations(month);
"""


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def build_database(snapshot_dir: Path, raw_dir: Path, db_path: Path) -> dict[str, int]:
    """從快照與原始回應重建整個 SQLite 檔，回傳各表的列數。

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
        _insert_lookups(db, catalog)
        all_series = [
            _load(snapshot_dir / entry["file"]) for entry in catalog["series"]
        ]
        _insert_series(db, all_series)
        _insert_giovanni(db, all_series, raw_dir / "giovanni")
        _insert_harmony(db, all_series, raw_dir / "harmony")
        _insert_power(db, all_series, raw_dir / "power")
        _insert_ghcnh(db, all_series, raw_dir / "ghcnh")
        db.commit()
        tables = [
            "variables",
            "locations",
            "series",
            "observations",
            *SOURCE_TABLES.values(),
        ]
        counts = {
            table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in tables
        }
    finally:
        db.close()
    partial.replace(db_path)
    return counts


def _insert_lookups(db: sqlite3.Connection, catalog: dict[str, Any]) -> None:
    for v in catalog["variables"]:
        db.execute(
            "INSERT INTO variables VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
            ),
        )
    for loc in catalog["locations"]:
        bbox = loc.get("bbox") or [None] * 4
        db.execute(
            "INSERT INTO locations VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
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
            ),
        )


def _insert_series(db: sqlite3.Connection, all_series: list[dict[str, Any]]) -> None:
    for s in all_series:
        key = (s["variable_id"], s["location_id"], s["aggregation"])
        months = [p["month"] for p in s["points"]]
        grid = s.get("grid") or {}
        db.execute(
            "INSERT INTO series VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
            ),
        )
        db.executemany(
            "INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)",
            [
                (
                    *key,
                    p["month"],
                    p["value"],
                    p["n_samples"],
                    p["coverage"],
                    s["unit"],
                    s["source_api"],
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
            "INSERT INTO src_harmony VALUES (?,?,?,?)",
            [
                (s["variable_id"], s["location_id"], day.isoformat(), value)
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="從快照與原始回應重建 SQLite 檔")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--db", type=Path, default=DB_PATH)
    args = parser.parse_args(argv)
    counts = build_database(args.snapshot_dir, args.raw_dir, args.db)
    print(args.db)
    for table, count in counts.items():
        note = (
            "  ← 找不到這個來源的原始檔"
            if count == 0 and table.startswith("src_")
            else ""
        )
        print(f"  {table:<16} {count:>8}{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
