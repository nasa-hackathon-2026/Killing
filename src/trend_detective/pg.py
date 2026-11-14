"""PostgreSQL 清洗資料庫（#83）：載入、清洗、匯出。

資料庫是本機的 Docker 容器（`db/compose.yaml`：PostgreSQL 17＋TimescaleDB＋PostGIS），schema 在
`db/migrations/*.sql`。用法（在 repo 根目錄）：

    uv run python -m trend_detective.pg init-env   # 第一次：把 PG* 連線設定與隨機密碼追加到 .env
    docker compose --env-file .env -f db/compose.yaml up -d
    uv run python -m trend_detective.pg load       # 清空六個 schema、跑 migration、載入全部資料
    uv run python -m trend_detective.pg clean      # 旗標、距平、補值、清洗摘要
    uv run python -m trend_detective.pg export     # cleaning.json、db/schema.sql、資料 dump
    uv run python -m trend_detective.pg analysis   # 把趨勢與探勘的結果檔寫回 analysis.*（#85）
    uv run python -m trend_detective.pg status     # 各表列數

`load` 每次都從頭重建（先 DROP 六個 schema），所以是冪等的。輸入與 SQLite 匯出相同：
`data/snapshot/`（核心）、`data/extended/`（擴充，有目錄檔才載）、`data/raw/`（各來源表；沒有就留空）、
`data/seed/cleaning.json`（清洗規則與已知問題）、`data/grid/`（趨勢格點）。

清洗的算法在 `trend_detective.cleaning`（純函式）；這裡負責把 `obs.observations` 讀出來、算完寫回
`clean.observations`，再用 TimescaleDB 的 `time_bucket_gapfill`（`obs.missing_months()`）獨立數一次
缺月，兩邊對不上就報錯。連線設定讀環境變數或 `.env` 的 `PGHOST`、`PGPORT`、`PGUSER`、
`PGPASSWORD`、`PGDATABASE`；密碼不會印出來。
"""

import argparse
import json
import math
import os
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterable, Iterator
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, LiteralString, cast

import numpy as np
import psycopg
from psycopg.types.json import Jsonb

from trend_detective import cleaning
from trend_detective.extended import EXTENDED_DIR
from trend_detective.grid import read_frontend
from trend_detective.snapshot import RAW_DIR, SEED_DIR, SNAPSHOT_DIR
from trend_detective.sqlite_export import SOURCE_TABLES, build_database
from trend_detective.trends import ANALYSIS_DIR, _dump, _round

# 在 worktree 裡工作時，可用這個環境變數指到主 checkout 的 .env
ENV_FILE = Path(os.environ.get("TREND_DETECTIVE_ENV_FILE", ".env"))
MIGRATIONS_DIR = Path("db/migrations")
SCHEMA_FILE = Path("db/schema.sql")
GRID_DIR = Path("data/grid")
DUMP_DIR = Path("data/pg-dump")
CONTAINER = "trend-detective-postgres"
SCHEMAS = ("meta", "raw", "obs", "clean", "geo", "analysis")
PG_DEFAULTS = {
    "PGHOST": "127.0.0.1",
    "PGPORT": "55432",
    "PGUSER": "trend",
    "PGDATABASE": "trend_detective",
}
EARTH_RADIUS_KM = 6371.0088
SUMMARY_SCHEMA_VERSION = 1

SOURCE_DESCRIPTIONS = {
    "giovanni": "NASA Giovanni /timeseries, single grid point",
    "harmony": "NASA Harmony area-mean jobs (bounding box)",
    "nasa_power": "NASA POWER monthly point API",
    "noaa_ghcnh": "NOAA GHCNh hourly station files, averaged to months",
    "appeears": "NASA AppEEARS area statistics per MODIS composite",
    "planetary_computer": "MODIS COGs on Microsoft Planetary Computer, statistics computed locally",
    "grid": "Area-weighted regional means computed locally from global grid cubes",
}
# raw.* 每個來源：SQLite 來源表裡的時間鍵欄與主要數值欄；其餘欄位進 payload
RAW_COLUMNS = {
    "giovanni": ("timestamp", "value"),
    "harmony": ("timestamp", "value"),
    "nasa_power": ("period", "value"),
    "noaa_ghcnh": ("local_date", "mean_temp_c"),
    "appeears": ("date", "mean"),
    "planetary_computer": ("date", "mean"),
    "grid": ("month", "value"),
}
# raw.grid 的 payload 只留逐月會變或查詢常用的欄位；bbox、網格間距等在 meta.series.request
GRID_PAYLOAD = ("coverage", "cube_id", "n_cells")
VARIABLE_COLUMNS = (
    "id", "name_zh", "name_en", "definition_zh", "category", "unit", "source",
    "source_variable_id", "product", "product_version", "native_temporal_res",
    "is_nasa", "doi", "citation", "note_zh",
)  # fmt: skip
LOCATION_COLUMNS = ("id", "kind", "name_zh", "name_en", "lat", "lon")
POLICY = {
    "trend_tests": (
        "No gap filling. Trend tests use value_clean: months flagged missing, "
        "partial_month or low_coverage are left out. Filling would raise the "
        "autocorrelation and lower the variance, which makes tests optimistic."
    ),
    "data_mining": (
        "Filled on the anomaly, only for the complete month table that mining "
        "needs: gaps of up to max_linear_gap_months consecutive months are "
        "linearly interpolated; longer gaps get anomaly 0 (the monthly "
        "climatology); nothing is extrapolated before the first or after the "
        "last usable month. The previous month is never carried forward. Every "
        "filled value keeps a fill_method. A series with more than "
        "max_fill_fraction of its months filled is not used."
    ),
    "raw_values": "value_raw is never changed; flags only mark, they do not delete.",
}


# ---------------------------------------------------------------- 連線設定


def _read_env_file(env_file: Path) -> dict[str, str]:
    """只取 `PG` 開頭的鍵；其他內容（別的憑證）不讀進來。"""
    found: dict[str, str] = {}
    if not env_file.exists():
        return found
    for line in env_file.read_text(encoding="utf-8").splitlines():
        key, separator, raw = line.partition("=")
        key = key.strip()
        if separator and key.startswith("PG"):
            found[key] = raw.strip().strip("\"'")
    return found


def pg_settings(env_file: Path) -> dict[str, str]:
    """連線設定：環境變數優先，其次 `.env`，最後是預設值（密碼沒有預設值）。"""
    from_file = _read_env_file(env_file)
    settings = {}
    for key in (*PG_DEFAULTS, "PGPASSWORD"):
        value = os.environ.get(key) or from_file.get(key) or PG_DEFAULTS.get(key)
        if value:
            settings[key] = value
    return settings


def init_env(env_file: Path) -> list[str]:
    """把還沒有的 `PG*` 設定追加到 `.env`（密碼隨機產生），回傳新增的鍵名。既有內容不動、不印出。"""
    present = _read_env_file(env_file)
    wanted = {**PG_DEFAULTS, "PGPASSWORD": secrets.token_urlsafe(24)}
    missing = {key: value for key, value in wanted.items() if key not in present}
    if not missing:
        return []
    existing = env_file.read_bytes() if env_file.exists() else b""
    with env_file.open("a", encoding="utf-8") as handle:
        if existing and not existing.endswith(b"\n"):
            handle.write("\n")
        for key, value in missing.items():
            handle.write(f"{key}={value}\n")
    env_file.chmod(0o600)
    return sorted(missing)


def connect(env_file: Path, *, autocommit: bool = False) -> psycopg.Connection[Any]:
    settings = pg_settings(env_file)
    if "PGPASSWORD" not in settings:
        raise SystemExit(
            f"找不到 PGPASSWORD。先跑 `uv run python -m trend_detective.pg init-env`"
            f"（會寫進 {env_file}），再啟動容器。"
        )
    return psycopg.connect(
        host=settings["PGHOST"],
        port=int(settings["PGPORT"]),
        user=settings["PGUSER"],
        password=settings["PGPASSWORD"],
        dbname=settings["PGDATABASE"],
        autocommit=autocommit,
    )


def database_available(env_file: Path = ENV_FILE) -> bool:
    """連得上就回 True；給整合測試決定要不要跳過。"""
    settings = pg_settings(env_file)
    if "PGPASSWORD" not in settings:
        return False
    try:
        with connect(env_file) as conn:
            conn.execute("SELECT 1")
    except psycopg.Error:
        return False
    return True


# ---------------------------------------------------------------- migration 與紀錄


def _sql(text: str) -> LiteralString:
    """組出來的 SQL（表名、migration 檔）。只接程式自己的常數與 repo 裡的檔，不接使用者輸入。"""
    return cast(LiteralString, text)


def git_commit() -> str | None:
    try:
        done = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return done.stdout.strip() or None


def reset(conn: psycopg.Connection[Any]) -> None:
    """刪掉這個專案的六個 schema（連同裡面全部的表）。擴充套件留著。"""
    for schema in SCHEMAS:
        conn.execute(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


def migrate(conn: psycopg.Connection[Any], migrations_dir: Path) -> list[str]:
    files = sorted(migrations_dir.glob("*.sql"))
    if not files:
        raise SystemExit(f"{migrations_dir} 裡沒有 migration 檔")
    for path in files:
        conn.execute(_sql(path.read_text(encoding="utf-8")))
    return [path.name for path in files]


def record_run(
    conn: psycopg.Connection[Any],
    step: str,
    started: datetime,
    parameters: dict[str, Any],
    rows_affected: dict[str, Any],
    note: str | None = None,
) -> int:
    row = conn.execute(
        "INSERT INTO analysis.runs (step, started_at, finished_at, git_commit,"
        " parameters, rows_affected, note) VALUES (%s, %s, %s, %s, %s, %s, %s)"
        " RETURNING run_id",
        (
            step,
            started,
            datetime.now(UTC),
            git_commit(),
            Jsonb(parameters),
            Jsonb(rows_affected),
            note,
        ),
    ).fetchone()
    assert row is not None
    return int(row[0])


def table_counts(conn: psycopg.Connection[Any]) -> dict[str, int]:
    """六個 schema 裡每張表與 materialized view 的實際列數。"""
    names = conn.execute(
        "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname = ANY(%s)"
        " UNION ALL SELECT schemaname || '.' || matviewname FROM pg_matviews"
        " WHERE schemaname = ANY(%s)"
        " UNION ALL SELECT view_schema || '.' || view_name"
        " FROM timescaledb_information.continuous_aggregates WHERE view_schema = ANY(%s)"
        " ORDER BY 1",
        (list(SCHEMAS), list(SCHEMAS), list(SCHEMAS)),
    ).fetchall()
    counts = {}
    for (name,) in names:
        row = conn.execute(_sql(f"SELECT count(*) FROM {name}")).fetchone()
        assert row is not None
        counts[name] = int(row[0])
    return counts


# ---------------------------------------------------------------- 載入


def _load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def series_key(item: dict[str, Any]) -> str:
    return f"{item['variable_id']}__{item['location_id']}__{item['aggregation']}"


def read_inputs(
    snapshot_dir: Path, extended_dir: Path | None
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[tuple[str, Path]]]:
    """回傳 (變數, 地點, [(tier, 序列檔路徑)])。兩邊都有的變數、地點、序列以核心為準。"""
    catalog = _load(snapshot_dir / "catalog.json")
    variables = {v["id"]: {**v, "tier": "core"} for v in catalog["variables"]}
    locations = {loc["id"]: {**loc, "tier": "core"} for loc in catalog["locations"]}
    files = {
        series_key(e): ("core", snapshot_dir / e["file"]) for e in catalog["series"]
    }
    if extended_dir is not None and (extended_dir / "catalog.json").exists():
        extended = _load(extended_dir / "catalog.json")
        for v in extended["variables"]:
            variables.setdefault(v["id"], {**v, "tier": "extended"})
        for loc in extended["locations"]:
            if loc["id"] in locations:
                # 核心地點在擴充目錄裡多了 group（taiwan）
                locations[loc["id"]].setdefault("group", loc.get("group"))
            else:
                locations[loc["id"]] = {**loc, "tier": "extended"}
        for e in extended["series"]:
            files.setdefault(series_key(e), ("extended", extended_dir / e["file"]))
    ordered = sorted(files.items(), key=lambda item: (item[1][0], item[0]))
    return (
        list(variables.values()),
        list(locations.values()),
        [value for _, value in ordered],
    )


def box_area_km2(west: float, south: float, east: float, north: float) -> float:
    """球面上經緯方框的面積。方框的南北邊是緯線，不是大圓，所以不用 `ST_Area(geography)`。"""
    return (
        EARTH_RADIUS_KM**2
        * math.radians(east - west)
        * (math.sin(math.radians(north)) - math.sin(math.radians(south)))
    )


def _load_lookups(
    conn: psycopg.Connection[Any],
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    issues: list[cleaning.KnownIssue],
    rules: cleaning.CleaningRules,
    rule_notes: dict[str, str],
) -> None:
    for source, description in SOURCE_DESCRIPTIONS.items():
        conn.execute(
            "INSERT INTO meta.sources VALUES (%s, %s, %s)",
            (source, f"raw.{source}", description),
        )
    for name, value in vars(rules).items():
        conn.execute(
            "INSERT INTO meta.cleaning_rules VALUES (%s, %s, %s)",
            (name, float(value), rule_notes.get(name)),
        )
    for issue in issues:
        conn.execute(
            "INSERT INTO meta.known_issues VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                issue.id,
                issue.kind,
                issue.variable_id,
                issue.variable_pattern,
                issue.aggregation,
                issue.period_start,
                issue.period_end,
                issue.flag_months,
                issue.summary_en,
                issue.source_doc,
                issue.issue_ref,
            ),
        )
    for v in variables:
        attributes = {
            key: value
            for key, value in v.items()
            if key not in VARIABLE_COLUMNS and key not in ("tier", "needs_translation")
        }
        conn.execute(
            "INSERT INTO meta.variables VALUES"
            " (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                *(v.get(column) for column in VARIABLE_COLUMNS),
                v["tier"],
                bool(v.get("needs_translation")),
                cleaning.is_auxiliary(v["id"], issues),
                Jsonb(attributes),
            ),
        )
    for loc in locations:
        bbox = loc.get("bbox") or [None] * 4
        attributes = {
            key: value
            for key, value in loc.items()
            if key not in LOCATION_COLUMNS
            and key not in ("tier", "group", "bbox", "geojson")
        }
        conn.execute(
            "INSERT INTO meta.locations VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (
                loc["id"],
                loc["kind"],
                loc.get("group"),
                loc.get("name_zh"),
                loc.get("name_en"),
                loc.get("lat"),
                loc.get("lon"),
                *bbox,
                loc["tier"],
                Jsonb(attributes),
            ),
        )
        if loc.get("bbox"):
            conn.execute(
                "INSERT INTO geo.regions VALUES"
                " (%s, %s, ST_MakeEnvelope(%s, %s, %s, %s, 4326), %s)",
                (loc["id"], loc.get("group"), *bbox, box_area_km2(*loc["bbox"])),
            )
        elif loc.get("lat") is not None and loc.get("lon") is not None:
            conn.execute(
                "INSERT INTO geo.locations VALUES"
                " (%s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))",
                (loc["id"], loc["lon"], loc["lat"]),
            )


def _load_series(
    conn: psycopg.Connection[Any], files: list[tuple[str, Path]]
) -> tuple[int, int]:
    """序列與統一表。回傳 (序列數, 觀測列數)。"""
    loaded = [(tier, _load(path)) for tier, path in files]
    rows = []
    for series_id, (tier, s) in enumerate(loaded, start=1):
        months = [p["month"] for p in s["points"]]
        grid = s.get("grid") or {}
        rows.append(
            (
                series_id,
                s["variable_id"],
                s["location_id"],
                s["aggregation"],
                tier,
                s["source_api"],
                s["unit"],
                s["product_version"],
                s["retrieved_at"],
                grid.get("lat"),
                grid.get("lon"),
                len(months),
                min(months) if months else None,
                max(months) if months else None,
                Jsonb(s["request"]),
            )
        )
    # 序列先寫（統一表的外鍵指向它），再用 COPY 一次送出全部觀測列
    with conn.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO meta.series (series_id, variable_id, location_id, aggregation,"
            " tier, source_api, unit, product_version, retrieved_at, grid_lat, grid_lon,"
            " n_points, first_month, last_month, request)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            rows,
        )
    n_rows = 0
    with (
        conn.cursor() as cursor,
        cursor.copy(
            "COPY obs.observations (series_id, month, value_raw, n_samples, coverage,"
            " source_api, tier) FROM STDIN"
        ) as copy,
    ):
        for series_id, (tier, s) in enumerate(loaded, start=1):
            for p in s["points"]:
                copy.write_row(
                    (
                        series_id,
                        p["month"],
                        p["value"],
                        p["n_samples"],
                        p["coverage"],
                        s["source_api"],
                        tier,
                    )
                )
            n_rows += len(s["points"])
    return len(loaded), n_rows


def _load_raw(
    conn: psycopg.Connection[Any],
    snapshot_dir: Path,
    raw_dir: Path,
    extended_dir: Path | None,
) -> dict[str, int]:
    """各來源表：重用 SQLite 匯出的解析（建到暫存檔），再搬進 `raw.*`。"""
    counts: dict[str, int] = {}
    with tempfile.TemporaryDirectory() as directory:
        db_path = Path(directory) / "raw.sqlite"
        build_database(snapshot_dir, raw_dir, db_path, extended_dir, None)
        db = sqlite3.connect(db_path)
        db.row_factory = sqlite3.Row
        try:
            for source, table in SOURCE_TABLES.items():
                key_column, value_column = RAW_COLUMNS[source]
                columns = [row[1] for row in db.execute(f"PRAGMA table_info({table})")]
                fixed = ("variable_id", "location_id", key_column, value_column)
                extra = [
                    name
                    for name in columns
                    if name not in fixed and (source != "grid" or name in GRID_PAYLOAD)
                ]
                n = 0
                with (
                    conn.cursor() as cursor,
                    cursor.copy(
                        _sql(
                            f"COPY raw.{source} (variable_id, location_id, obs_key,"
                            " value, payload) FROM STDIN"
                        )
                    ) as copy,
                ):
                    for row in db.execute(f"SELECT * FROM {table}"):
                        payload = {
                            name: row[name] for name in extra if row[name] is not None
                        }
                        copy.write_row((*(row[name] for name in fixed), Jsonb(payload)))
                        n += 1
                counts[f"raw.{source}"] = n
        finally:
            db.close()
    return counts


def grid_cell_rows(directory: Path) -> tuple[dict[str, Any], Iterator[tuple[Any, ...]]]:
    """趨勢地圖有分析的格子：(meta, 逐格的 (lat, lon, lat_step, lon_step, 面積, 斜率, 顯著性類別))。"""
    meta, arrays = read_frontend(directory)
    grid = meta["grid"]
    slope = arrays["trend_slope_per_decade"][0]
    significance = arrays["trend_significance"][0]
    lat_step, lon_step = float(grid["lat_step"]), float(grid["lon_step"])

    def rows() -> Iterator[tuple[Any, ...]]:
        for i, j in zip(*np.nonzero(significance > 0), strict=True):
            if np.isnan(slope[i, j]):
                continue
            south = grid["lat_south_edge"] + int(i) * lat_step
            west = grid["lon_west_edge"] + int(j) * lon_step
            yield (
                south + lat_step / 2,
                west + lon_step / 2,
                lat_step,
                lon_step,
                box_area_km2(west, south, west + lon_step, south + lat_step),
                float(slope[i, j]),
                int(significance[i, j]),
            )

    return meta, rows()


def _load_grid(conn: psycopg.Connection[Any], grid_dir: Path) -> int:
    n = 0
    for directory in sorted(
        p for p in grid_dir.glob("*") if (p / "meta.json").exists()
    ):
        meta, rows = grid_cell_rows(directory)
        if "trend" not in meta:
            continue
        layer = next(e for e in meta["layers"] if e["name"] == "trend_slope_per_decade")
        period = meta["trend"].get("period", {})
        conn.execute(
            "INSERT INTO geo.grid_layers VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (
                meta["id"],
                meta.get("name_en"),
                layer.get("unit"),
                period.get("first_month"),
                period.get("last_month"),
                Jsonb(meta["grid"]),
                Jsonb(meta["trend"]),
            ),
        )
        conn.execute(
            "CREATE TEMP TABLE cells_in (lat float8, lon float8, lat_step float8,"
            " lon_step float8, area_km2 float8, slope float8, significance int2)"
            " ON COMMIT DROP"
        )
        with (
            conn.cursor() as cursor,
            cursor.copy("COPY cells_in FROM STDIN") as copy,
        ):
            for row in rows:
                copy.write_row(row)
                n += 1
        conn.execute(
            "INSERT INTO geo.grid_cells SELECT %s, lat, lon,"
            " ST_SetSRID(ST_MakePoint(lon, lat), 4326), lat_step, lon_step, area_km2,"
            " slope, significance FROM cells_in",
            (meta["id"],),
        )
        conn.execute("DROP TABLE cells_in")
    return n


def load(
    env_file: Path,
    *,
    snapshot_dir: Path,
    extended_dir: Path | None,
    raw_dir: Path,
    seed_file: Path,
    grid_dir: Path,
    migrations_dir: Path,
) -> dict[str, Any]:
    """清空並重建整個資料庫（不含清洗）。回傳各階段耗時與列數。"""
    started = datetime.now(UTC)
    timings: dict[str, float] = {}
    rules, issues = cleaning.load_seed(seed_file)
    rule_notes = _load(seed_file).get("rule_notes", {})
    variables, locations, files = read_inputs(snapshot_dir, extended_dir)
    with connect(env_file) as conn:
        clock = time.monotonic()
        reset(conn)
        applied = migrate(conn, migrations_dir)
        timings["migrate"] = time.monotonic() - clock

        clock = time.monotonic()
        _load_lookups(conn, variables, locations, issues, rules, rule_notes)
        timings["lookups"] = time.monotonic() - clock

        clock = time.monotonic()
        n_series, n_observations = _load_series(conn, files)
        timings["series"] = time.monotonic() - clock

        clock = time.monotonic()
        raw_counts = _load_raw(conn, snapshot_dir, raw_dir, extended_dir)
        timings["raw"] = time.monotonic() - clock

        clock = time.monotonic()
        n_cells = _load_grid(conn, grid_dir)
        timings["grid"] = time.monotonic() - clock

        rows = {
            "meta.series": n_series,
            "obs.observations": n_observations,
            **raw_counts,
            "geo.grid_cells": n_cells,
        }
        record_run(
            conn,
            "load",
            started,
            {
                "snapshot_dir": snapshot_dir.as_posix(),
                "extended_dir": extended_dir.as_posix() if extended_dir else None,
                "raw_dir": raw_dir.as_posix(),
                "migrations": applied,
            },
            rows,
        )
        conn.commit()
    # continuous aggregate 的重算不能在交易裡
    clock = time.monotonic()
    with connect(env_file, autocommit=True) as conn:
        conn.execute("CALL refresh_continuous_aggregate('obs.yearly_mean', NULL, NULL)")
        conn.execute("ANALYZE")
    timings["refresh"] = time.monotonic() - clock
    return {"timings_seconds": timings, "rows": rows}


# ---------------------------------------------------------------- 清洗


def _number(value: float) -> float | None:
    return None if math.isnan(value) else float(value)


def _series_points(
    conn: psycopg.Connection[Any],
) -> Iterator[tuple[int, list[dict[str, Any]]]]:
    """從 `obs.observations` 依序列逐條讀出 `points`（與序列檔同樣的形狀）。"""
    current: int | None = None
    points: list[dict[str, Any]] = []
    with conn.cursor(name="observations_stream") as cursor:
        cursor.itersize = 50_000
        cursor.execute(
            "SELECT series_id, month, value_raw, n_samples, coverage"
            " FROM obs.observations ORDER BY series_id, month"
        )
        for series_id, month, value, n_samples, coverage in cursor:
            if series_id != current:
                if current is not None:
                    yield current, points
                current, points = series_id, []
            points.append(
                {
                    "month": month.isoformat(),
                    "value": value,
                    "n_samples": n_samples,
                    "coverage": coverage,
                }
            )
    if current is not None:
        yield current, points


def read_known_issues(conn: psycopg.Connection[Any]) -> list[cleaning.KnownIssue]:
    return [
        cleaning.KnownIssue(
            id=row[0],
            kind=row[1],
            variable_id=row[2],
            variable_pattern=row[3],
            aggregation=row[4],
            period_start=row[5].isoformat() if row[5] else None,
            period_end=row[6].isoformat() if row[6] else None,
            flag_months=row[7],
            summary_en=row[8],
            source_doc=row[9],
            issue_ref=row[10],
        )
        for row in conn.execute(
            "SELECT id, kind, variable_id, variable_pattern, aggregation, period_start,"
            " period_end, flag_months, summary_en, source_doc, issue_ref"
            " FROM meta.known_issues ORDER BY id"
        )
    ]


def clean(env_file: Path) -> dict[str, Any]:
    """重算 `clean.observations` 與 `clean.series_summary`，並和 `time_bucket_gapfill` 的缺月數核對。"""
    started = datetime.now(UTC)
    clock = time.monotonic()
    with connect(env_file) as conn, connect(env_file) as writer:
        rules = cleaning.CleaningRules(
            **{
                name: (int(value) if name == "max_linear_gap_months" else value)
                for name, value in conn.execute(
                    "SELECT name, value FROM meta.cleaning_rules"
                )
            }
        )
        issues = read_known_issues(conn)
        series = {
            row[0]: (row[1], row[2], row[3])
            for row in conn.execute(
                "SELECT series_id, variable_id, aggregation,"
                " to_char(retrieved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM meta.series"
            )
        }
        writer.execute("TRUNCATE clean.observations, clean.series_summary")
        summaries: list[tuple[Any, ...]] = []
        n_rows = n_no_row = n_null_value = 0
        with (
            writer.cursor() as cursor,
            cursor.copy(
                "COPY clean.observations (series_id, month, in_source, value_raw,"
                " value_clean, qc_flag, qc_flags, anomaly, anomaly_filled, fill_method,"
                " n_samples, coverage) FROM STDIN"
            ) as copy,
        ):
            for series_id, points in _series_points(conn):
                variable_id, aggregation, retrieved_at = series[series_id]
                cleaned = cleaning.clean_series(
                    points,
                    variable_id=variable_id,
                    aggregation=aggregation,
                    retrieved_at=retrieved_at,
                    rules=rules,
                    issues=issues,
                )
                months = cleaned.months
                for i in range(cleaned.n_months):
                    copy.write_row(
                        (
                            series_id,
                            months[i],
                            bool(cleaned.in_source[i]),
                            _number(cleaned.value_raw[i]),
                            _number(cleaned.value_clean[i]),
                            cleaned.qc_flag[i],
                            list(cleaned.qc_flags[i]),
                            _number(cleaned.anomaly[i]),
                            _number(cleaned.anomaly_filled[i]),
                            cleaned.fill_method[i],
                            cleaned.n_samples[i],
                            _number(cleaned.coverage[i]),
                        )
                    )
                n_rows += cleaned.n_months
                n_no_row += int((~cleaned.in_source).sum())
                n_null_value += int(
                    (cleaned.in_source & np.isnan(cleaned.value_raw)).sum()
                )
                summary = cleaning.summarize(cleaned, rules)
                flags = summary["n_by_flag"]
                summaries.append(
                    (
                        series_id,
                        summary["n_months"],
                        summary["n_in_source"],
                        summary["n_usable"],
                        summary["first_usable_month"],
                        summary["last_usable_month"],
                        flags["ok"],
                        flags["missing"],
                        flags["partial_month"],
                        flags["low_coverage"],
                        flags["outlier_suspect"],
                        flags["known_discontinuity"],
                        summary["n_filled"],
                        summary["n_filled_linear"],
                        summary["n_filled_climatology"],
                        summary["n_gaps"],
                        summary["longest_gap_months"],
                        summary["fill_fraction"],
                        summary["mining_eligible"],
                        summary["auxiliary"],
                        summary["known_issues"],
                        Jsonb(summary),
                    )
                )
        with writer.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO clean.series_summary VALUES"
                " (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                summaries,
            )
        writer.execute("REFRESH MATERIALIZED VIEW clean.monthly_climatology")
        # 用 TimescaleDB 的 time_bucket_gapfill 獨立數一次缺月，和上面 Python 算的核對
        gapfill = dict.fromkeys(("no_row", "null_value"), 0)
        for kind, count in writer.execute(
            "SELECT missing_kind, count(*) FROM obs.missing_months() GROUP BY 1"
        ):
            gapfill[kind] = int(count)
        if gapfill != {"no_row": n_no_row, "null_value": n_null_value}:
            raise SystemExit(
                "缺月數對不上：time_bucket_gapfill 得到 "
                f"{gapfill}，清洗得到 no_row = {n_no_row}、null_value = {n_null_value}"
            )
        rows = {
            "clean.observations": n_rows,
            "clean.series_summary": len(summaries),
            "missing_no_row": n_no_row,
            "missing_null_value": n_null_value,
            "gapfill_cross_check": gapfill,
        }
        run_id = record_run(
            writer,
            "clean",
            started,
            {
                "rules": vars(rules),
                "known_issues": [issue.id for issue in issues],
                "flag_priority": list(cleaning.FLAGS),
            },
            rows,
        )
        writer.commit()
    with connect(env_file, autocommit=True) as conn:
        conn.execute("ANALYZE clean.observations")
    return {"run_id": run_id, "seconds": time.monotonic() - clock, "rows": rows}


# ---------------------------------------------------------------- 匯出

SUM_FIELDS = (
    "n_months", "n_in_source", "n_usable", "n_ok", "n_missing", "n_partial_month",
    "n_low_coverage", "n_outlier_suspect", "n_known_discontinuity", "n_filled",
    "n_filled_linear", "n_filled_climatology", "n_gaps",
)  # fmt: skip


def _totals(conn: psycopg.Connection[Any], where: str = "TRUE") -> dict[str, Any]:
    sums = ", ".join(f"coalesce(sum(q.{name}), 0)" for name in SUM_FIELDS)
    row = conn.execute(
        _sql(
            f"SELECT count(*), {sums}, coalesce(max(q.longest_gap_months), 0),"
            " count(*) FILTER (WHERE q.mining_eligible),"
            " count(*) FILTER (WHERE q.auxiliary),"
            " count(*) FILTER (WHERE cardinality(q.known_issues) > 0),"
            " count(*) FILTER (WHERE q.n_filled > 0)"
            " FROM clean.series_summary q JOIN meta.series s USING (series_id)"
            f" WHERE {where}"
        )
    ).fetchone()
    assert row is not None
    values = [int(v) for v in row]
    return {
        "n_series": values[0],
        **dict(zip(SUM_FIELDS, values[1 : 1 + len(SUM_FIELDS)], strict=True)),
        "longest_gap_months": values[-5],
        "n_series_mining_eligible": values[-4],
        "n_series_auxiliary": values[-3],
        "n_series_with_known_issues": values[-2],
        "n_series_with_filled_months": values[-1],
    }


def cleaning_summary(conn: psycopg.Connection[Any], tier: str) -> dict[str, Any]:
    """清洗摘要：規則、已知問題、全庫與各分組的彙總，以及 `tier` 這一層每條序列的摘要。"""
    rules = {
        name: {"value": value, "note_en": note}
        for name, value, note in conn.execute(
            "SELECT name, value, note_en FROM meta.cleaning_rules ORDER BY name"
        )
    }
    n_series_by_issue = dict(
        conn.execute(
            "SELECT issue_id, count(*) FROM meta.series_known_issues GROUP BY 1"
        ).fetchall()
    )
    issues = [
        {**asdict(issue), "n_series": n_series_by_issue.get(issue.id, 0)}
        for issue in read_known_issues(conn)
    ]
    groups = conn.execute(
        "SELECT DISTINCT tier, aggregation FROM meta.series ORDER BY 1, 2"
    ).fetchall()
    series = {
        f"{variable}__{location}__{aggregation}": detail
        for variable, location, aggregation, detail in conn.execute(
            "SELECT s.variable_id, s.location_id, s.aggregation, q.detail"
            " FROM clean.series_summary q JOIN meta.series s USING (series_id)"
            " WHERE s.tier = %s ORDER BY 1, 2, 3",
            (tier,),
        )
    }
    return _round(
        {
            "schema_version": SUMMARY_SCHEMA_VERSION,
            "policy": POLICY,
            "flag_priority": list(cleaning.FLAGS),
            "rules": rules,
            "known_issues": issues,
            "totals": {
                "all": _totals(conn),
                "by_tier": {
                    name: _totals(conn, f"s.tier = '{name}'")
                    for name in sorted({group[0] for group in groups})
                },
                "by_tier_and_aggregation": {
                    f"{t}/{a}": _totals(
                        conn, f"s.tier = '{t}' AND s.aggregation = '{a}'"
                    )
                    for t, a in groups
                },
            },
            "series_tier": tier,
            "series": series,
        }
    )


def _pg_dump(container: str, env_file: Path, arguments: list[str]) -> bytes:
    """在容器裡跑 pg_dump（本機不必裝 PostgreSQL 用戶端）。密碼經環境變數傳入，不在指令列上。"""
    settings = pg_settings(env_file)
    environment = {**os.environ, "PGPASSWORD": settings.get("PGPASSWORD", "")}
    done = subprocess.run(
        [
            "docker",
            "exec",
            "-e",
            "PGPASSWORD",
            container,
            "pg_dump",
            "-h",
            "127.0.0.1",
            "-U",
            settings["PGUSER"],
            "-d",
            settings["PGDATABASE"],
            *arguments,
        ],
        capture_output=True,
        env=environment,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(
            f"pg_dump 失敗：{done.stderr.decode(errors='replace')[-2000:]}"
        )
    return done.stdout


def export(
    env_file: Path,
    *,
    analysis_dir: Path,
    extended_dir: Path | None,
    schema_file: Path,
    dump_dir: Path | None,
    container: str,
) -> dict[str, Any]:
    """寫出清洗摘要（核心進 git、擴充不進）、schema-only SQL，以及（有給目錄時）資料 dump。"""
    written: dict[str, Any] = {}
    with connect(env_file) as conn:
        run = conn.execute(
            "SELECT run_id, started_at, finished_at, git_commit, parameters,"
            " rows_affected FROM analysis.runs WHERE step = 'clean'"
            " ORDER BY run_id DESC LIMIT 1"
        ).fetchone()
        if run is None:
            raise SystemExit(
                "還沒有清洗紀錄。先跑 `uv run python -m trend_detective.pg clean`。"
            )
        server = conn.execute("SHOW server_version").fetchone()
        core = cleaning_summary(conn, "core")
        _dump(analysis_dir / "cleaning.json", core)
        _dump(
            analysis_dir / "cleaning.run.json",
            {
                "command": "uv run python -m trend_detective.pg clean && "
                "uv run python -m trend_detective.pg export",
                "generated_at": run[2].astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "database": {
                    "run_id": run[0],
                    "git_commit": run[3],
                    "server": server[0] if server else None,
                    "extensions": dict(
                        conn.execute(
                            "SELECT extname, extversion FROM pg_extension"
                            " WHERE extname IN ('timescaledb', 'postgis', 'pg_trgm')"
                            " ORDER BY 1"
                        ).fetchall()
                    ),
                },
                "parameters": run[4],
                "rows_affected": run[5],
                "outputs": ["cleaning.json"],
                "totals": core["totals"]["all"],
            },
        )
        written["cleaning"] = (analysis_dir / "cleaning.json").as_posix()
        has_extended = conn.execute(
            "SELECT EXISTS (SELECT 1 FROM meta.series WHERE tier = 'extended')"
        ).fetchone()
        if extended_dir is not None and has_extended and has_extended[0]:
            path = extended_dir / "analysis" / "cleaning.json"
            _dump(path, cleaning_summary(conn, "extended"))
            written["cleaning_extended"] = path.as_posix()
    schema_arguments = ["--schema-only", "--no-owner", "--no-privileges"]
    for schema in SCHEMAS:
        schema_arguments += ["-n", schema]
    text = _pg_dump(container, env_file, schema_arguments).decode("utf-8")
    # pg_dump 17.6 起每次會寫不同的 \restrict 權杖；拿掉才能重跑時逐位元組相同
    lines = [
        line
        for line in text.splitlines()
        if not line.startswith(("\\restrict", "\\unrestrict"))
    ]
    schema_file.parent.mkdir(parents=True, exist_ok=True)
    schema_file.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    written["schema"] = schema_file.as_posix()
    if dump_dir is not None:
        dump_dir.mkdir(parents=True, exist_ok=True)
        path = dump_dir / "trend_detective.dump"
        path.write_bytes(_pg_dump(container, env_file, ["--format=custom"]))
        written["dump"] = path.as_posix()
        written["dump_bytes"] = path.stat().st_size
    return written


# ---------------------------------------------------------------- 趨勢與探勘的結果


def _trend_rows(
    content: dict[str, Any], ids: dict[str, int], run_id: int
) -> list[tuple[Any, ...]]:
    group_by = (content.get("fdr") or {}).get("group_by", "all")
    rows = []
    for key, item in content["series"].items():
        if key not in ids:
            continue
        data = item["data"]
        ols = item.get("ols") or {}
        mk = item.get("mann_kendall") or {}
        ci = ols.get("ci_per_decade") or [None, None]
        scope = (
            "all series of the run"
            if group_by == "all"
            else f"{group_by} = {item[group_by]}"
        )
        rows.append(
            (
                ids[key],
                run_id,
                item["status"],
                (item.get("reason") or {}).get("code"),
                data.get("first_month"),
                data.get("last_month"),
                data.get("n_valid"),
                data.get("missing_fraction"),
                ols.get("slope_per_decade"),
                ci[0],
                ci[1],
                ols.get("p"),
                ols.get("p_fdr"),
                ols.get("significant"),
                ols.get("significant_fdr"),
                ols.get("lag1_autocorrelation"),
                ols.get("n_effective"),
                (mk.get("original") or {}).get("p"),
                (mk.get("original") or {}).get("p_fdr"),
                (mk.get("hamed_rao") or {}).get("p"),
                (mk.get("hamed_rao") or {}).get("p_fdr"),
                (mk.get("seasonal") or {}).get("p"),
                (mk.get("seasonal") or {}).get("p_fdr"),
                (item.get("sen") or {}).get("slope_per_decade"),
                scope,
                bool(item.get("auxiliary", False)),
                item.get("known_issues", []),
                Jsonb(item.get("cleaning", {})),
                Jsonb(item),
            )
        )
    return rows


def load_analysis(
    env_file: Path, *, analysis_dir: Path, extended_dir: Path | None
) -> dict[str, int]:
    """把趨勢與探勘的結果檔寫回 `analysis.*`（整批換新）。檔案不在的部分略過。"""
    counts: dict[str, int] = {}
    with connect(env_file) as conn:
        conn.execute(
            "TRUNCATE analysis.trends, analysis.mining_runs, analysis.mining_rules,"
            " analysis.tree_folds"
        )
        ids = {
            (tier, f"{variable}__{location}__{aggregation}"): series_id
            for series_id, tier, variable, location, aggregation in conn.execute(
                "SELECT series_id, tier, variable_id, location_id, aggregation"
                " FROM meta.series"
            )
        }
        sources = [("core", analysis_dir / "trends.json")]
        if extended_dir is not None:
            sources.append(("extended", extended_dir / "analysis" / "trends.json"))
        for tier, path in sources:
            if not path.exists():
                continue
            started = datetime.now(UTC)
            content = _load(path)
            tier_ids = {key: sid for (t, key), sid in ids.items() if t == tier}
            run_id = record_run(
                conn,
                f"trends_{tier}",
                started,
                {
                    "file": path.as_posix(),
                    "parameters": content["parameters"],
                    "fdr": content.get("fdr", {"group_by": "all"}),
                    "cleaning": content.get("cleaning"),
                    "packages": content["packages"],
                },
                {"summary": content["summary"]},
            )
            rows = _trend_rows(content, tier_ids, run_id)
            with conn.cursor() as cursor:
                cursor.executemany(
                    _sql(
                        f"INSERT INTO analysis.trends VALUES ({','.join(['%s'] * 29)})"
                    ),
                    rows,
                )
            counts[f"analysis.trends ({tier})"] = len(rows)
        rules_path = analysis_dir / "fpgrowth.json"
        if rules_path.exists():
            started = datetime.now(UTC)
            content = _load(rules_path)
            sensitivity = content.get("gap_filling_sensitivity", {})
            summary = {
                kind: {
                    timing: {
                        name: table[timing][name]
                        for name in (
                            "n_transactions",
                            "n_candidate_rules",
                            "n_rules",
                            "n_persistence_rules",
                        )
                    }
                    for timing in ("same_month", "lagged_one_month")
                }
                for kind, table in content["tables"].items()
            }
            run_id = record_run(
                conn,
                "fpgrowth",
                started,
                {"file": rules_path.as_posix(), "parameters": content["parameters"]},
                {"summary": summary},
            )
            conn.execute(
                "INSERT INTO analysis.mining_runs VALUES (%s, 'fpgrowth', %s, %s, %s, %s)",
                (
                    run_id,
                    sensitivity.get("primary", "unfilled"),
                    Jsonb(content["parameters"]),
                    Jsonb(summary),
                    Jsonb(sensitivity),
                ),
            )
            rule_rows = [
                (
                    run_id,
                    kind,
                    timing,
                    rule_set,
                    rank,
                    rule["antecedents"],
                    rule["consequent"],
                    rule["support"],
                    rule["confidence"],
                    rule["lift"],
                    rule["p"],
                    rule["q"],
                )
                for kind, table in content["tables"].items()
                for timing in ("same_month", "lagged_one_month")
                for rule_set in ("rules", "persistence_rules")
                for rank, rule in enumerate(table[timing][rule_set], start=1)
            ]
            with conn.cursor() as cursor:
                cursor.executemany(
                    "INSERT INTO analysis.mining_rules VALUES"
                    " (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    rule_rows,
                )
            counts["analysis.mining_rules"] = len(rule_rows)
        tree_path = analysis_dir / "decision_tree.json"
        if tree_path.exists():
            started = datetime.now(UTC)
            content = _load(tree_path)
            sensitivity = content.get("gap_filling_sensitivity", {})
            primary = sensitivity.get("primary", "unfilled")
            run_id = record_run(
                conn,
                "decision_tree",
                started,
                {"file": tree_path.as_posix(), "parameters": content["parameters"]},
                {"summary": content["summary"]},
            )
            conn.execute(
                "INSERT INTO analysis.mining_runs VALUES"
                " (%s, 'decision_tree', %s, %s, %s, %s)",
                (
                    run_id,
                    primary,
                    Jsonb(content["parameters"]),
                    Jsonb(content["summary"]),
                    Jsonb(sensitivity),
                ),
            )
            trees = {fold["fold"]: fold.get("tree") for fold in content["folds"]}
            fold_rows = [
                (
                    run_id,
                    variant,
                    fold["fold"],
                    fold["test_first_month"],
                    fold["test_last_month"],
                    fold["n_train"],
                    fold["n_test"],
                    fold["test_accuracy"],
                    fold["train_majority_accuracy"],
                    fold["test_majority_accuracy"],
                    fold["persistence_accuracy"],
                    Jsonb(trees.get(fold["fold"])) if variant == primary else None,
                )
                for variant in ("filled", "unfilled")
                for fold in sensitivity.get(variant, {}).get("folds", [])
            ]
            with conn.cursor() as cursor:
                cursor.executemany(
                    "INSERT INTO analysis.tree_folds VALUES"
                    " (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    fold_rows,
                )
            counts["analysis.tree_folds"] = len(fold_rows)
        conn.commit()
    return counts


# ---------------------------------------------------------------- CLI


def _print_counts(counts: Iterable[tuple[str, Any]]) -> None:
    for name, count in counts:
        print(f"  {name:<32} {count!s:>10}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument("--env-file", type=Path, default=ENV_FILE)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init-env", help="把 PG* 連線設定與隨機密碼追加到 .env")
    loader = commands.add_parser("load", help="清空六個 schema、跑 migration、載入資料")
    loader.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    loader.add_argument("--extended-dir", type=Path, default=EXTENDED_DIR)
    loader.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    loader.add_argument("--seed-file", type=Path, default=SEED_DIR / "cleaning.json")
    loader.add_argument("--grid-dir", type=Path, default=GRID_DIR)
    loader.add_argument("--migrations-dir", type=Path, default=MIGRATIONS_DIR)
    commands.add_parser("clean", help="重算旗標、距平、補值與清洗摘要")
    exporter = commands.add_parser(
        "export", help="寫出清洗摘要、schema SQL 與資料 dump"
    )
    exporter.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    exporter.add_argument("--extended-dir", type=Path, default=EXTENDED_DIR)
    exporter.add_argument("--schema-file", type=Path, default=SCHEMA_FILE)
    exporter.add_argument("--dump-dir", type=Path, default=DUMP_DIR)
    exporter.add_argument("--no-dump", action="store_true", help="不寫資料 dump")
    exporter.add_argument("--container", default=CONTAINER)
    migrator = commands.add_parser(
        "migrate", help="只跑 migration（可重跑；不清空、不重新載入）"
    )
    migrator.add_argument("--migrations-dir", type=Path, default=MIGRATIONS_DIR)
    results = commands.add_parser(
        "analysis", help="把趨勢與探勘的結果檔寫回 analysis.*"
    )
    results.add_argument("--analysis-dir", type=Path, default=ANALYSIS_DIR)
    results.add_argument("--extended-dir", type=Path, default=EXTENDED_DIR)
    commands.add_parser("status", help="列出各表列數")
    args = parser.parse_args(argv)

    if args.command == "init-env":
        added = init_env(args.env_file)
        print(
            f"已在 {args.env_file} 追加：{'、'.join(added)}"
            if added
            else f"{args.env_file} 已經有全部的 PG* 設定，沒有變動"
        )
        return 0
    if args.command == "load":
        result = load(
            args.env_file,
            snapshot_dir=args.snapshot_dir,
            extended_dir=args.extended_dir,
            raw_dir=args.raw_dir,
            seed_file=args.seed_file,
            grid_dir=args.grid_dir,
            migrations_dir=args.migrations_dir,
        )
        print("載入完成，各階段秒數：")
        _print_counts((k, f"{v:.1f}") for k, v in result["timings_seconds"].items())
        _print_counts(result["rows"].items())
        return 0
    if args.command == "clean":
        result = clean(args.env_file)
        print(f"清洗完成（run_id {result['run_id']}，{result['seconds']:.1f} 秒）：")
        _print_counts(result["rows"].items())
        return 0
    if args.command == "export":
        written = export(
            args.env_file,
            analysis_dir=args.analysis_dir,
            extended_dir=args.extended_dir,
            schema_file=args.schema_file,
            dump_dir=None if args.no_dump else args.dump_dir,
            container=args.container,
        )
        _print_counts(written.items())
        return 0
    if args.command == "migrate":
        with connect(args.env_file) as conn:
            print("已套用：" + "、".join(migrate(conn, args.migrations_dir)))
        return 0
    if args.command == "analysis":
        _print_counts(
            load_analysis(
                args.env_file,
                analysis_dir=args.analysis_dir,
                extended_dir=args.extended_dir,
            ).items()
        )
        return 0
    with connect(args.env_file) as conn:
        _print_counts(table_counts(conn).items())
    return 0


if __name__ == "__main__":
    sys.exit(main())
