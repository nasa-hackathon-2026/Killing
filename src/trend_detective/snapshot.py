"""重新產生靜態快照：抓取、轉成統一格式、寫出序列檔與目錄檔。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：
    uv run python -m trend_detective.snapshot

變數與地點的清單是資料，放在 `data/seed/variables.json`、`locations.json`。
單一序列失敗不會中斷整批；結束時列出成功與失敗清單。
"""

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx

from trend_detective import ghcnh, power
from trend_detective.env import read_secret
from trend_detective.giovanni import (
    GiovanniClient,
    GiovanniError,
    GiovanniSeries,
    QuotaExceeded,
    parse_timeseries_csv,
)
from trend_detective.series import (
    Series,
    daily_to_monthly_points,
    monthly_points,
    write_catalog,
    write_series,
)

SNAPSHOT_DIR = Path("data/snapshot")
SEED_DIR = Path("data/seed")
RAW_DIR = Path("data/raw")
START_DATE = date(2001, 1, 1)
# 測站序列從這一年起（#11）
STATION_START_YEAR = 2000
# 台灣測站的當地時間，用來把逐時觀測歸到當地日
STATION_UTC_OFFSET_HOURS = 8
# 靠海點位被遮罩時，最多往內陸移幾格
MAX_INLAND_STEPS = 2
SOURCES = ("giovanni", "noaa_ghcnh", "nasa_power")

Key = tuple[str, str]


@dataclass
class SnapshotResult:
    written: list[Path] = field(default_factory=list)
    succeeded: list[Key] = field(default_factory=list)
    # (variable_id, location_id) → 失敗原因
    failures: dict[Key, str] = field(default_factory=dict)
    # 因為被遮罩而改用內陸格點的序列 → 實際使用的座標
    shifted: dict[Key, list[float]] = field(default_factory=dict)


def load_seed(seed_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """讀變數與地點清單。"""
    variables = json.loads((seed_dir / "variables.json").read_text(encoding="utf-8"))
    locations = json.loads((seed_dir / "locations.json").read_text(encoding="utf-8"))
    return variables, locations


def _fetch_unmasked(
    client: GiovanniClient,
    variable: dict[str, Any],
    location: dict[str, Any],
    today: date,
) -> tuple[str, GiovanniSeries, list[float]]:
    """抓一條點位序列。整條都是缺值代表格點被遮罩（Giovanni 不會報錯），

    地點有 `inland_direction` 時往內陸移一格重試。回傳 (原始 CSV, 解析結果, 實際座標)。
    """
    lat, lon = float(location["lat"]), float(location["lon"])
    direction = location.get("inland_direction")
    for attempt in range(MAX_INLAND_STEPS + 1):
        text, _request = client.fetch_timeseries(
            variable["source_variable_id"],
            lat=lat,
            lon=lon,
            start=START_DATE,
            end=today,
        )
        parsed = parse_timeseries_csv(text)
        if not parsed.rows:
            raise GiovanniError(f"回應沒有資料列，座標 [{lat},{lon}]")
        if any(value is not None for _, value in parsed.rows):
            return text, parsed, [lat, lon]
        if (
            direction is None
            or parsed.lat_resolution is None
            or parsed.lon_resolution is None
            or attempt == MAX_INLAND_STEPS
        ):
            break
        lat = round(lat + direction[0] * parsed.lat_resolution, 6)
        lon = round(lon + direction[1] * parsed.lon_resolution, 6)
    raise GiovanniError(f"格點被遮罩（整條都是缺值），最後嘗試的座標 [{lat},{lon}]")


def _series_on_disk(snapshot_dir: Path) -> list[Series]:
    """讀出目前所有序列檔；損毀或欄位與現行格式不合的檔案略過。"""
    found = []
    for path in sorted((snapshot_dir / "series").glob("*.json")):
        try:
            found.append(Series(**json.loads(path.read_text(encoding="utf-8"))))
        except (OSError, ValueError, TypeError):
            continue
    return found


def build_snapshot(
    client: GiovanniClient | None,
    snapshot_dir: Path,
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    *,
    today: date,
    now: str,
    raw_dir: Path | None = None,
    station_http: httpx.Client | None = None,
    power_http: httpx.Client | None = None,
) -> SnapshotResult:
    """抓每個變數在它適用的地點的序列並寫檔，最後依磁碟上的序列檔寫目錄檔。

    變數依 `source` 分派：`giovanni`、`nasa_power` 抓一般點位，`noaa_ghcnh` 抓有 `ghcnh_id` 的測站。
    對應的 client 沒給（None）就略過該來源，既有的序列檔照樣列在目錄檔。
    單一序列失敗不中斷整批，先前寫出的檔案保留；quota 用完時 Giovanni 之後的序列都不再送。
    """
    result = SnapshotResult()
    out_of_quota = False
    points = [loc for loc in locations if "ghcnh_id" not in loc]
    stations = [loc for loc in locations if "ghcnh_id" in loc]
    for variable in variables:
        source = variable["source"]
        if source == "giovanni" and client is not None:
            targets = points
        elif source == "noaa_ghcnh" and station_http is not None:
            targets = stations
        elif source == "nasa_power" and power_http is not None:
            targets = points
        else:
            continue
        for location in targets:
            key = (variable["id"], location["id"])
            try:
                if source == "giovanni":
                    if out_of_quota:
                        raise QuotaExceeded("quota 已達上限，未抓取")
                    assert client is not None
                    series = _one_series(
                        client, variable, location, today, now, raw_dir
                    )
                elif source == "nasa_power":
                    assert power_http is not None
                    series = _power_series(
                        power_http, variable, location, today, now, raw_dir
                    )
                else:
                    assert station_http is not None
                    series = _station_series(
                        station_http, variable, location, today, now, raw_dir
                    )
                result.written.append(write_series(snapshot_dir, series))
            except QuotaExceeded as err:
                out_of_quota = True
                result.failures[key] = str(err)
            except Exception as err:  # noqa: BLE001 單一序列不論何種失敗都不中斷整批
                result.failures[key] = f"{type(err).__name__}: {err}"
            else:
                result.succeeded.append(key)
                if "requested_location" in series.request:
                    result.shifted[key] = series.request["location"]
    variable_ids = {variable["id"] for variable in variables}
    location_ids = {location["id"] for location in locations}
    all_series = [
        series
        for series in _series_on_disk(snapshot_dir)
        if series.variable_id in variable_ids and series.location_id in location_ids
    ]
    catalog_variables = [_describe(variable, all_series) for variable in variables]
    result.written.append(
        write_catalog(
            snapshot_dir, catalog_variables, locations, all_series, generated_at=now
        )
    )
    return result


def _power_series(
    http: httpx.Client,
    variable: dict[str, Any],
    location: dict[str, Any],
    today: date,
    now: str,
    raw_dir: Path | None,
) -> Series:
    """從 NASA POWER 抓一個點位的月平均序列。"""
    parameter = variable["source_variable_id"]
    params = power.query(
        parameter,
        lat=float(location["lat"]),
        lon=float(location["lon"]),
        end_year=today.year,
    )
    payload = power.fetch_monthly(http, params)
    parsed = power.parse_monthly(payload, parameter)
    if raw_dir is not None:
        raw_path = raw_dir / "power" / f"{variable['id']}__{location['id']}.json"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    # 結束年是執行當年，每年不同；理由同 Giovanni 的 end_policy
    request = {key: value for key, value in params.items() if key != "end"}
    request["end_policy"] = "run_date"
    request["api_version"] = parsed.api_version
    request["sources"] = parsed.sources
    # POWER 會把還沒發布的月份回成缺值；結尾連續的缺值月不算資料，去掉
    rows = list(parsed.rows)
    while rows and rows[-1][1] is None:
        rows.pop()
    return Series(
        variable_id=variable["id"],
        location_id=location["id"],
        aggregation="point",
        unit=parsed.unit,
        source_api="nasa_power",
        request=request,
        retrieved_at=now,
        product_version=variable["product_version"],
        grid=None,
        points=monthly_points(rows),
    )


def _station_series(
    http: httpx.Client,
    variable: dict[str, Any],
    location: dict[str, Any],
    today: date,
    now: str,
    raw_dir: Path | None,
) -> Series:
    """下載一個測站各年的逐時檔，轉成月均溫序列。逐時原檔只存在 `raw_dir`。"""
    station_id = location["ghcnh_id"]
    hourly: list[ghcnh.Hourly] = []
    for year in range(STATION_START_YEAR, today.year + 1):
        cached = (
            raw_dir / "ghcnh" / f"GHCNh_{station_id}_{year}.psv" if raw_dir else None
        )
        # 兩年以前的檔不會再變，有存檔就不重抓。今年與去年每次都重抓：
        # 去年的存檔可能是年底前抓的，還不完整。
        if cached is not None and cached.exists() and year < today.year - 1:
            text = cached.read_text(encoding="utf-8")
        else:
            text = ghcnh.fetch_year(http, station_id, year)
            if text is not None and cached is not None:
                cached.parent.mkdir(parents=True, exist_ok=True)
                # 先寫暫存檔再改名，中斷時不會留下被當成完整的半個檔
                partial = cached.with_suffix(".psv.part")
                partial.write_text(text, encoding="utf-8")
                partial.replace(cached)
        if text is not None:
            hourly.extend(ghcnh.parse_psv(text))
    if not hourly:
        raise ghcnh.GhcnhError(f"測站 {station_id} 沒有任何氣溫觀測")
    daily = ghcnh.hourly_to_daily(hourly, utc_offset_hours=STATION_UTC_OFFSET_HOURS)
    return Series(
        variable_id=variable["id"],
        location_id=location["id"],
        aggregation="station",
        unit="degC",
        source_api="noaa_ghcnh",
        request={
            "station": station_id,
            "element": "temperature",
            "start_year": STATION_START_YEAR,
            "end_policy": "run_date",
            "min_days_per_month": ghcnh.MIN_DAYS_PER_MONTH,
            "local_day_utc_offset_hours": STATION_UTC_OFFSET_HOURS,
        },
        retrieved_at=now,
        product_version=variable["product_version"],
        grid=None,
        points=ghcnh.station_monthly_points(daily),
    )


def _one_series(
    client: GiovanniClient,
    variable: dict[str, Any],
    location: dict[str, Any],
    today: date,
    now: str,
    raw_dir: Path | None,
) -> Series:
    """抓一條點位序列、存原始回應、轉成統一格式。"""
    text, parsed, used = _fetch_unmasked(client, variable, location, today)
    if raw_dir is not None:
        raw_path = raw_dir / "giovanni" / f"{variable['id']}__{location['id']}.csv"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(text, encoding="utf-8")
    requested = [float(location["lat"]), float(location["lon"])]
    # 實際送出的結束日是執行當天，每天不同；記成 end_policy 而不是日期，
    # 重跑才不會產生無意義的 diff。實際涵蓋範圍看 points 的起訖月。
    request: dict[str, Any] = {
        "data": variable["source_variable_id"],
        "location": used,
        "start": f"{START_DATE:%Y-%m-%d}",
        "end_policy": "run_date",
    }
    if used != requested:
        request["requested_location"] = requested
    to_points = (
        daily_to_monthly_points
        if variable["native_temporal_res"] == "day"
        else monthly_points
    )
    return Series(
        variable_id=variable["id"],
        location_id=location["id"],
        aggregation="point",
        unit=parsed.unit,
        source_api="giovanni",
        request=request,
        retrieved_at=now,
        product_version=variable["product_version"],
        grid={"lat": parsed.grid_lat, "lon": parsed.grid_lon},
        points=to_points(parsed.rows),
    )


def _describe(variable: dict[str, Any], all_series: list[Series]) -> dict[str, Any]:
    """目錄檔的變數條目：seed 的說明，加上從資料得到的單位與有效期間。"""
    own = [s for s in all_series if s.variable_id == variable["id"]]
    months = [p["month"] for s in own for p in s.points if p["value"] is not None]
    units = sorted({s.unit for s in own})
    if len(units) > 1:
        raise ValueError(f"{variable['id']} 各序列的單位不一致：{units}")
    return {
        **variable,
        "unit": units[0] if units else None,
        "valid_from": min(months) if months else None,
        "valid_to": max(months) if months else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="重新產生靜態快照")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--seed-dir", type=Path, default=SEED_DIR)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    parser.add_argument(
        "--source",
        choices=SOURCES,
        action="append",
        help="只重抓這個來源（可重複指定）；預設全部。其他來源的既有序列檔保留",
    )
    args = parser.parse_args(argv)
    sources = args.source or list(SOURCES)
    giovanni_client = None
    if "giovanni" in sources:
        token = read_secret(
            "EARTHDATA_TOKEN",
            args.env_file,
            how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
        )
        giovanni_client = GiovanniClient(token)
    station_http = httpx.Client(timeout=120) if "noaa_ghcnh" in sources else None
    power_http = httpx.Client(timeout=120) if "nasa_power" in sources else None
    variables, locations = load_seed(args.seed_dir)
    now = datetime.now(UTC)
    result = build_snapshot(
        giovanni_client,
        args.snapshot_dir,
        variables,
        locations,
        today=now.date(),
        now=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        raw_dir=args.raw_dir,
        station_http=station_http,
        power_http=power_http,
    )
    print(f"成功 {len(result.succeeded)} 條，失敗 {len(result.failures)} 條")
    for (variable_id, location_id), used in result.shifted.items():
        print(f"  內移 {variable_id} @ {location_id} → {used}")
    for (variable_id, location_id), reason in result.failures.items():
        print(f"  失敗 {variable_id} @ {location_id}：{reason}")
    return 1 if result.failures else 0


if __name__ == "__main__":
    sys.exit(main())
