"""台灣所有有長期紀錄的 NOAA GHCNh 測站氣溫（#88，母票 #4）。

從 GHCNh 官方測站清單篩出台灣範圍的候選測站，逐站下載逐時檔，用 `ghcnh.py`
的日平均與月平均算法（和核心快照的 `station_temp` 完全相同）轉成月序列，
2001-01 至 2025-12 至少有 `min_valid_months` 個可用月份的測站才保留。

輸出（都不進 git）：
- 原檔：`<raw-dir>/GHCNh_<測站 id>_<年>.psv`、`manifest.json`（網址、大小、取得時間）
- 序列：`<out-dir>/series/station_temp__stn_<id 小寫>__station.json`、`catalog.json`
- `<out-dir>/stations.json`：全部候選測站與取捨原因；`<out-dir>/sanity.json`：趨勢與每日觀測數

測站清單、盤點表與判斷規則的資料在 `data/seed/sources/ghcnh_taiwan.json`。
下載一站一年一個檔、依序抓、每次間隔 `REQUEST_DELAY_SECONDS`，不平行。
"""

import argparse
import csv
import json
import statistics
import time
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import numpy as np

from trend_detective import ghcnh, series, trends

SOURCE_ID = "ghcnh_taiwan"
VARIABLE_ID = "station_temp"
DOC_BASE_URL = "https://noaa-ghcnh-pds.s3.amazonaws.com/hourly/doc/"
STATION_LIST_URL = DOC_BASE_URL + "ghcnh-station-list.csv"
INVENTORY_URL = DOC_BASE_URL + "ghcnh-inventory.txt"
# 台灣本島與離島的搜尋方框 (緯度下限, 緯度上限, 經度下限, 經度上限)
SEARCH_BOX = (21.5, 25.5, 118.0, 122.5)
# AWS 上的逐年檔（by-year）從 2000 年起才有（2026-11-15 實測：1999 年以前的目錄是空的，
# 更早的資料只在整站一個檔的 by-station/*_por.psv），和核心快照的 `STATION_START_YEAR` 相同
FIRST_FILE_YEAR = 2000
EVAL_FIRST = date(2001, 1, 1)
EVAL_LAST = date(2025, 12, 1)
MIN_VALID_MONTHS = 240
MIN_COVERAGE = 0.25
# 盤點表上限落在 [PROBE_MIN_BOUND, MIN_VALID_MONTHS) 的測站只抓評估期間，算出實際月數記在 stations.json
PROBE_MIN_BOUND = 100
# 台灣的地方標準時間是 UTC+8，與核心快照的 `STATION_UTC_OFFSET_HOURS` 相同
UTC_OFFSET_HOURS = 8
REQUEST_DELAY_SECONDS = 0.25
REGION_ORDER = ("east", "north", "central", "south")

SEED_PATH = Path("data/seed/sources/ghcnh_taiwan.json")
LOCATIONS_SEED_PATH = Path("data/seed/locations.json")
VARIABLES_SEED_PATH = Path("data/seed/variables.json")


@dataclass(frozen=True)
class Station:
    id: str
    lat: float
    lon: float
    elevation_m: float | None
    state: str
    name: str
    wmo_id: str
    icao: str
    iso_code: str


@dataclass(frozen=True)
class StationResult:
    series: series.Series
    daily: list[ghcnh.Daily]


def location_id(station_id: str) -> str:
    """地點 id：`stn_` 加測站 id 小寫。"""
    return f"stn_{station_id.lower()}"


def parse_station_list(text: str) -> list[Station]:
    """讀 GHCNh 官方測站清單 CSV；欄位以表頭名稱為準。"""
    stations = []
    for row in csv.DictReader(text.splitlines()):
        elevation = row["ELEVATION"].strip()
        stations.append(
            Station(
                id=row["GHCN_ID"].strip(),
                lat=float(row["LATITUDE"]),
                lon=float(row["LONGITUDE"]),
                elevation_m=float(elevation) if elevation else None,
                state=row["STATE"].strip(),
                name=row["NAME"].strip(),
                wmo_id=row["WMO_ID"].strip(),
                icao=row["ICAO"].strip(),
                iso_code=row["ISO_CODE"].strip(),
            )
        )
    return stations


def in_search_box(station: Station) -> bool:
    lat_min, lat_max, lon_min, lon_max = SEARCH_BOX
    return lat_min <= station.lat <= lat_max and lon_min <= station.lon <= lon_max


def candidate_class(
    station: Station, decisions: dict[str, dict[str, str]]
) -> tuple[str, str]:
    """(類別, 原因)：`taiwan`、`mainland_coast`、`needs_review`。

    有明確判斷（seed 的 `candidate_decisions`）就照它；沒有的話國別碼 TW 是台灣，
    其他（GHCNh 把中央氣象署的測站記成 CN，也有中國大陸沿岸的測站）不猜，列為待確認。
    """
    decision = decisions.get(station.id)
    if decision is not None:
        return decision["class"], decision["reason"]
    if station.iso_code == "TW":
        return "taiwan", "GHCNh country code TW"
    return "needs_review", f"country code {station.iso_code}, no explicit decision"


def assign_region(
    station: Station, regions: dict[str, list[float]], *, offshore_ids: set[str]
) -> str:
    """依 `locations.json` 的區域方框 [west, south, east, north] 判定 north／central／south／east。

    方框互相重疊時依 `REGION_ORDER`（east 先）。不在任何方框內、或明列為離島的標 `offshore`。
    """
    if station.id in offshore_ids:
        return "offshore"
    for name in REGION_ORDER:
        west, south, east, north = regions[name]
        if west <= station.lon <= east and south <= station.lat <= north:
            return name
    return "offshore"


Inventory = dict[int, list[int]]


def parse_inventory(text: str, ids: Iterable[str]) -> dict[str, Inventory]:
    """讀 GHCNh 盤點表（`ghcnh-inventory.txt`），只留 `ids` 的測站：{id: {年: 12 個月的觀測筆數}}。"""
    wanted = set(ids)
    result: dict[str, Inventory] = {}
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) == 14 and parts[0] in wanted:
            result.setdefault(parts[0], {})[int(parts[1])] = [
                int(count) for count in parts[2:]
            ]
    return result


def max_possible_months(
    inventory: Inventory,
    first_year: int,
    last_year: int,
    *,
    min_days: int = ghcnh.MIN_DAYS_PER_MONTH,
) -> int:
    """盤點表給的月份上限：當月觀測筆數不到 `min_days`，就不可能有 `min_days` 個有觀測的日子。"""
    return sum(
        1
        for year in range(first_year, last_year + 1)
        for count in inventory.get(year, [])
        if count >= min_days
    )


def inventory_years(
    inventory: Inventory, *, first: int | None = None, last: int | None = None
) -> list[int]:
    """有任何觀測的年份（可限定範圍）。"""
    return sorted(
        year
        for year, counts in inventory.items()
        if sum(counts) > 0
        and (first is None or year >= first)
        and (last is None or year <= last)
    )


def _in_range(month: str, first: date, last: date) -> bool:
    return first <= date.fromisoformat(month) <= last


def valid_months(
    points: list[dict[str, Any]],
    first: date = EVAL_FIRST,
    last: date = EVAL_LAST,
    *,
    min_coverage: float = MIN_COVERAGE,
) -> int:
    """範圍內有月平均、且 `coverage` 不低於清洗門檻的月數（門檻與 `cleaning.json` 相同）。"""
    return sum(
        1
        for point in points
        if _in_range(point["month"], first, last)
        and point["value"] is not None
        and point["coverage"] >= min_coverage
    )


def keep_decision(
    n_valid_months: int, *, minimum: int = MIN_VALID_MONTHS
) -> tuple[bool, str]:
    if n_valid_months >= minimum:
        return True, "kept"
    return False, "too_few_valid_months"


def trend_per_decade(
    points: list[dict[str, Any]],
    first: date = EVAL_FIRST,
    last: date = EVAL_LAST,
    *,
    min_months: int = 24,
) -> float | None:
    """範圍內月距平的最小平方法斜率（°C／十年），與 `trends.py` 同一個算法；月數太少回 None。"""
    params = trends.TrendParams()
    prepared = trends.prepare(
        [p for p in points if _in_range(p["month"], first, last)], params
    )
    if prepared.n_valid < min_months or np.ptp(prepared.anomalies) == 0:
        return None
    return float(
        trends.ols_trend(prepared.index, prepared.anomalies, params.alpha)[
            "slope_per_decade"
        ]
    )


def median_daily_observations(
    daily: list[ghcnh.Daily], first_year: int, last_year: int
) -> float | None:
    """範圍內（含）每個有觀測的當地日的觀測筆數的中位數；沒有任何日子回 None。"""
    counts = [n for day, _, n in daily if first_year <= day.year <= last_year]
    return statistics.median(counts) if counts else None


def observations_per_year(rows: list[ghcnh.Hourly]) -> dict[int, int]:
    """有氣溫的觀測筆數，依 UTC 時間所在的年（也就是檔案的年）。"""
    counts: dict[int, int] = defaultdict(int)
    for moment, _ in rows:
        counts[moment.year] += 1
    return dict(sorted(counts.items()))


def file_url(station_id: str, year: int) -> str:
    return ghcnh.year_url(station_id, year)


def build_station_series(
    station: Station,
    rows: list[ghcnh.Hourly],
    *,
    retrieved_at: str,
    file_urls: dict[int, str],
) -> StationResult:
    """逐時氣溫 → 日平均 → 月平均，用 `ghcnh.py` 的函式；`request` 記測站、檔案網址與每年觀測數。"""
    daily = ghcnh.hourly_to_daily(rows, utc_offset_hours=UTC_OFFSET_HOURS)
    points = ghcnh.station_monthly_points(daily)
    per_year = observations_per_year(rows)
    result = series.Series(
        variable_id=VARIABLE_ID,
        location_id=location_id(station.id),
        aggregation="station",
        unit="degC",
        source_api="noaa_ghcnh",
        request={
            "station": station.id,
            "station_name": station.name,
            "element": "temperature",
            "start_year": min(per_year) if per_year else None,
            "end_policy": "all_available_years",
            "min_days_per_month": ghcnh.MIN_DAYS_PER_MONTH,
            "local_day_utc_offset_hours": UTC_OFFSET_HOURS,
            "file_urls": {str(year): url for year, url in sorted(file_urls.items())},
            "observations_per_year": {str(y): n for y, n in per_year.items()},
        },
        retrieved_at=retrieved_at,
        product_version="GHCNh",
        grid=None,
        points=points,
    )
    return StationResult(result, daily)


# ---- 下載與執行（連網；不在單元測試裡） ----


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get(http: httpx.Client, url: str, *, attempts: int = 3) -> httpx.Response:
    """GET，連線錯誤與 5xx 退避重試；404 照常回傳。"""
    for attempt in range(1, attempts + 1):
        try:
            response = http.get(url)
        except httpx.TransportError:
            if attempt == attempts:
                raise
        else:
            if response.status_code < 500 or attempt == attempts:
                return response
        time.sleep(2**attempt)
    raise AssertionError("unreachable")


class Manifest:
    """每個下載檔的網址、大小、取得時間（`manifest.json`）；已有的記錄保留，同網址以新的為準。"""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.entries: dict[str, dict[str, Any]] = {}
        if path.exists():
            for entry in json.loads(path.read_text(encoding="utf-8")):
                self.entries[entry["url"]] = entry

    def record(self, url: str, status: int, size: int, local: str | None) -> None:
        self.entries[url] = {
            "url": url,
            "http_status": status,
            "bytes": size,
            "retrieved_at": _now(),
            "file": local,
        }
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        ordered = [self.entries[url] for url in sorted(self.entries)]
        self.path.write_text(
            json.dumps(ordered, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
        )


def fetch_text_cached(
    http: httpx.Client, url: str, path: Path, manifest: Manifest, *, refresh: bool
) -> str:
    """下載文字檔並存起來；已有存檔且不要求更新就直接讀。"""
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")
    response = _get(http, url)
    if response.status_code >= 400:
        raise ghcnh.GhcnhError(f"{url} → HTTP {response.status_code}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(response.text, encoding="utf-8")
    manifest.record(url, response.status_code, len(response.content), path.name)
    return response.text


def fetch_year_cached(
    http: httpx.Client,
    station_id: str,
    year: int,
    raw_dir: Path,
    manifest: Manifest,
    *,
    cache_dirs: Iterable[Path] = (),
) -> str | None:
    """一站一年的 PSV：先看存檔（`raw_dir` 與 `cache_dirs`），沒有才下載；該年沒有檔回 None。"""
    name = f"GHCNh_{station_id}_{year}.psv"
    for directory in (raw_dir, *cache_dirs):
        if (directory / name).exists():
            return (directory / name).read_text(encoding="utf-8")
    url = file_url(station_id, year)
    time.sleep(REQUEST_DELAY_SECONDS)
    response = _get(http, url)
    if response.status_code == 404:
        manifest.record(url, 404, 0, None)
        return None
    if response.status_code >= 400:
        raise ghcnh.GhcnhError(f"{url} → HTTP {response.status_code}")
    raw_dir.mkdir(parents=True, exist_ok=True)
    partial = raw_dir / (name + ".part")
    partial.write_text(response.text, encoding="utf-8")
    partial.replace(raw_dir / name)
    manifest.record(url, response.status_code, len(response.content), name)
    return response.text


def _load_years(
    http: httpx.Client,
    station_id: str,
    years: list[int],
    raw_dir: Path,
    manifest: Manifest,
    cache_dirs: Iterable[Path] = (),
) -> tuple[list[ghcnh.Hourly], dict[int, str]]:
    rows: list[ghcnh.Hourly] = []
    urls: dict[int, str] = {}
    for year in years:
        text = fetch_year_cached(
            http, station_id, year, raw_dir, manifest, cache_dirs=cache_dirs
        )
        if text is not None:
            rows.extend(ghcnh.parse_psv(text))
            urls[year] = file_url(station_id, year)
    return rows, urls


def _round(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else round(value, digits)


def _decade_medians(daily: list[ghcnh.Daily]) -> dict[str, float | None]:
    years = sorted({day.year for day, _, _ in daily})
    result: dict[str, float | None] = {}
    if not years:
        return result
    for start in range(years[0] // 10 * 10, years[-1] + 1, 10):
        end = start + 9
        if any(start <= y <= end for y in years):
            result[f"{start}s"] = median_daily_observations(daily, start, end)
    return result


def _sanity(points: list[dict[str, Any]], daily: list[ghcnh.Daily]) -> dict[str, Any]:
    return {
        "valid_months_2001_2025": valid_months(points),
        "trend_2001_2025_degC_per_decade": _round(trend_per_decade(points)),
        "median_daily_observations": {
            "2001-2005": median_daily_observations(daily, 2001, 2005),
            "2021-2025": median_daily_observations(daily, 2021, 2025),
            "by_decade": _decade_medians(daily),
        },
    }


def run(
    *,
    seed_path: Path,
    locations_seed_path: Path,
    raw_dir: Path,
    out_dir: Path,
    core_raw_dir: Path | None,
    refresh_lists: bool,
) -> dict[str, Any]:
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    regions = {
        loc["id"]: loc["bbox"]
        for loc in json.loads(locations_seed_path.read_text(encoding="utf-8"))
        if loc.get("kind") == "region"
    }
    offshore_ids = set(seed["offshore_station_ids"])
    core_stations: dict[str, str] = seed["core_stations"]
    decisions: dict[str, dict[str, str]] = seed["candidate_decisions"]
    manifest = Manifest(raw_dir / "manifest.json")

    with httpx.Client(timeout=120, follow_redirects=True) as http:
        station_list = parse_station_list(
            fetch_text_cached(
                http,
                STATION_LIST_URL,
                raw_dir / "ghcnh-station-list.csv",
                manifest,
                refresh=refresh_lists,
            )
        )
        candidates = [s for s in station_list if in_search_box(s)]
        inventory = parse_inventory(
            fetch_text_cached(
                http,
                INVENTORY_URL,
                raw_dir / "ghcnh-inventory.txt",
                manifest,
                refresh=refresh_lists,
            ),
            [s.id for s in candidates],
        )

        entries: list[dict[str, Any]] = []
        kept: list[tuple[Station, StationResult]] = []
        sanity: dict[str, Any] = {}
        retrieved_at = _now()
        cache_dirs = [core_raw_dir] if core_raw_dir else []
        for station in sorted(candidates, key=lambda s: s.id):
            klass, class_reason = candidate_class(station, decisions)
            inv = inventory.get(station.id, {})
            bound = max_possible_months(inv, EVAL_FIRST.year, EVAL_LAST.year)
            years_available = inventory_years(inv)
            entry: dict[str, Any] = {
                "id": station.id,
                "location_id": location_id(station.id),
                "name": station.name,
                "lat": station.lat,
                "lon": station.lon,
                "elevation_m": station.elevation_m,
                "iso_code": station.iso_code,
                "wmo_id": station.wmo_id or None,
                "icao": station.icao or None,
                "candidate_class": klass,
                "candidate_class_reason": class_reason,
                "region": assign_region(station, regions, offshore_ids=offshore_ids),
                "inventory_first_year": years_available[0] if years_available else None,
                "inventory_last_year": years_available[-1] if years_available else None,
                "inventory_years_with_observations": len(years_available),
                "inventory_max_months_2001_2025": bound,
                "valid_months_2001_2025": None,
                "downloaded": None,
            }
            entries.append(entry)
            if klass != "taiwan":
                entry.update(
                    decision="excluded",
                    reason_code=klass,
                    reason_text=class_reason,
                )
                continue
            is_core = station.id in core_stations
            if is_core:
                entry["core_location_id"] = core_stations[station.id]
            elif bound < PROBE_MIN_BOUND:
                entry.update(
                    decision="excluded",
                    reason_code="inventory_upper_bound",
                    reason_text=(
                        f"盤點表 2001–2025 只有 {bound} 個月的觀測筆數 ≥ 20，"
                        f"月數上限低於 {MIN_VALID_MONTHS}，未下載。"
                    ),
                )
                continue
            if is_core:
                years = inventory_years(inv, first=EVAL_FIRST.year, last=EVAL_LAST.year)
            elif bound >= MIN_VALID_MONTHS:
                years = inventory_years(inv, first=FIRST_FILE_YEAR)
            else:
                years = inventory_years(inv, first=EVAL_FIRST.year, last=EVAL_LAST.year)
            rows, urls = _load_years(
                http,
                station.id,
                years,
                raw_dir,
                manifest,
                cache_dirs=cache_dirs if is_core else (),
            )
            if not rows:
                entry.update(
                    decision="excluded",
                    reason_code="no_temperature_observations",
                    reason_text="下載的檔案裡沒有任何氣溫觀測。",
                )
                continue
            result = build_station_series(
                station, rows, retrieved_at=retrieved_at, file_urls=urls
            )
            n_valid = valid_months(result.series.points)
            entry["valid_months_2001_2025"] = n_valid
            entry["downloaded"] = {"years": sorted(urls), "n_files": len(urls)}
            valid = [p["month"] for p in result.series.points if p["value"] is not None]
            entry["first_valid_month"] = min(valid) if valid else None
            entry["last_valid_month"] = max(valid) if valid else None
            if is_core:
                entry.update(
                    decision="already_in_core",
                    reason_code="already_in_core_snapshot",
                    reason_text=(
                        f"已在核心快照（地點 {core_stations[station.id]}），"
                        "不重抓、不覆蓋；這裡只用既有原檔算合理性統計。"
                    ),
                )
                sanity[station.id] = _sanity(result.series.points, result.daily)
                continue
            keep, reason = keep_decision(n_valid)
            if keep:
                entry.update(
                    decision="kept",
                    reason_code=reason,
                    reason_text=f"2001–2025 有 {n_valid} 個可用月份。",
                )
                kept.append((station, result))
                sanity[station.id] = _sanity(result.series.points, result.daily)
            else:
                entry.update(
                    decision="excluded",
                    reason_code=reason,
                    reason_text=(
                        f"2001–2025 只有 {n_valid} 個可用月份（門檻 {MIN_VALID_MONTHS}）。"
                    ),
                )

    retained = write_outputs(out_dir, seed, entries, kept, sanity, retrieved_at)
    return {"entries": entries, "kept": retained, "sanity": sanity}


def write_outputs(
    out_dir: Path,
    seed: dict[str, Any],
    entries: list[dict[str, Any]],
    kept: list[tuple[Station, StationResult]],
    sanity: dict[str, Any],
    retrieved_at: str,
    variables_seed_path: Path = VARIABLES_SEED_PATH,
) -> list[str]:
    """序列檔、`catalog.json`、`stations.json`、`sanity.json`。保留的測站在 seed 要有地點定義。"""
    locations_by_id = {loc["id"]: loc for loc in seed.get("locations", [])}
    variable = next(v for v in seed["variables"] if v["id"] == VARIABLE_ID)
    all_series = []
    locations = []
    missing = []
    for station, result in kept:
        location = locations_by_id.get(location_id(station.id))
        if location is None:
            missing.append(station.id)
            continue
        locations.append(location)
        series.write_series(out_dir, result.series)
        all_series.append(result.series)
    if missing:
        raise KeyError(f"seed 的 locations 缺少保留測站的地點定義：{missing}")
    core_variable = next(
        v
        for v in json.loads(variables_seed_path.read_text(encoding="utf-8"))
        if v["id"] == VARIABLE_ID
    )
    months_with_value = [
        point["month"]
        for item in all_series
        for point in item.points
        if point["value"] is not None
    ]
    catalog_variable = {
        **core_variable,
        **{k: v for k, v in variable.items() if k != "reuse_core_variable"},
        "unit": "degC",
        "valid_from": min(months_with_value) if months_with_value else None,
        "valid_to": max(months_with_value) if months_with_value else None,
    }
    catalog_path = series.write_catalog(
        out_dir,
        [catalog_variable],
        locations,
        all_series,
        generated_at=retrieved_at,
    )
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog["source"] = SOURCE_ID
    catalog["already_in_core_snapshot"] = [
        {"ghcnh_id": ghcn_id, "location_id": loc_id}
        for ghcn_id, loc_id in seed["core_stations"].items()
    ]
    catalog["note"] = (
        "兩個核心測站（台北、台中）已在 data/snapshot/，這裡不重抓、不覆蓋；"
        "變數 station_temp 與核心快照是同一個量、同一個算法。"
    )
    catalog_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    stations_path = out_dir / "stations.json"
    stations_path.write_text(
        json.dumps(
            {
                "source": SOURCE_ID,
                "generated_at": retrieved_at,
                "station_list_url": STATION_LIST_URL,
                "inventory_url": INVENTORY_URL,
                "search_box": {
                    "lat": list(SEARCH_BOX[:2]),
                    "lon": list(SEARCH_BOX[2:]),
                },
                "evaluation": {
                    "first_month": EVAL_FIRST.isoformat(),
                    "last_month": EVAL_LAST.isoformat(),
                    "min_valid_months": MIN_VALID_MONTHS,
                    "min_coverage": MIN_COVERAGE,
                },
                "stations": entries,
            },
            ensure_ascii=False,
            indent=1,
            allow_nan=False,
        )
        + "\n",
        encoding="utf-8",
    )
    (out_dir / "sanity.json").write_text(
        json.dumps(sanity, ensure_ascii=False, indent=1, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    return [station.id for station, _ in kept]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--seed", type=Path, default=SEED_PATH)
    parser.add_argument("--locations-seed", type=Path, default=LOCATIONS_SEED_PATH)
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=Path("data/raw/ghcnh_taiwan"),
        help="原檔與 manifest",
    )
    parser.add_argument(
        "--out-dir", type=Path, default=Path("data/observed/ghcnh_taiwan")
    )
    parser.add_argument(
        "--core-raw-dir",
        type=Path,
        default=None,
        help="核心快照的逐時原檔（data/raw/ghcnh），既有兩站的檔從這裡讀，不重抓",
    )
    parser.add_argument("--refresh-lists", action="store_true")
    args = parser.parse_args(argv)
    outcome = run(
        seed_path=args.seed,
        locations_seed_path=args.locations_seed,
        raw_dir=args.raw_dir,
        out_dir=args.out_dir,
        core_raw_dir=args.core_raw_dir,
        refresh_lists=args.refresh_lists,
    )
    entries = outcome["entries"]
    counts: dict[str, int] = defaultdict(int)
    for entry in entries:
        counts[
            entry["reason_code"]
            if entry["decision"] == "excluded"
            else entry["decision"]
        ] += 1
    print(f"候選 {len(entries)} 站；保留 {len(outcome['kept'])}：{outcome['kept']}")
    print(dict(counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
