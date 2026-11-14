"""重新產生靜態快照：抓取、轉成統一格式、寫出序列檔與目錄檔。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：
    uv run python -m trend_detective.snapshot

變數與地點的清單是資料，放在 `data/seed/variables.json`、`locations.json`。
單一序列失敗不會中斷整批；結束時列出成功與失敗清單。
"""

import argparse
import json
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx

from trend_detective import ghcnh, power
from trend_detective.data_lists import OUT_DIR as LISTS_DIR
from trend_detective.data_lists import write_lists
from trend_detective.env import read_secret
from trend_detective.giovanni import (
    GiovanniClient,
    GiovanniError,
    GiovanniSeries,
    QuotaExceeded,
    parse_timeseries_csv,
)
from trend_detective.harmony import (
    FINISHED,
    HarmonyClient,
    HarmonyError,
    parse_area_csv,
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
SOURCES = ("giovanni", "harmony", "noaa_ghcnh", "nasa_power")
# 區域平均一次同時跑幾個 Harmony job，以及每個 job 最多等多久
HARMONY_BATCH = 6
HARMONY_POLL_SECONDS = 10
HARMONY_MAX_WAIT_SECONDS = 1800

Key = tuple[str, str]


@dataclass
class SnapshotResult:
    written: list[Path] = field(default_factory=list)
    succeeded: list[Key] = field(default_factory=list)
    # (variable_id, location_id) → 失敗原因
    failures: dict[Key, str] = field(default_factory=dict)
    # 因為被遮罩而改用內陸格點的序列 → 實際使用的座標
    shifted: dict[Key, list[float]] = field(default_factory=dict)
    # 這次沒有重新寫出、沿用先前檔案的序列：(variable_id, location_id, aggregation)
    not_updated: list[tuple[str, str, str]] = field(default_factory=list)


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
    harmony_client: HarmonyClient | None = None,
    sleep: Callable[[float], None] = time.sleep,
    stamp: bool = False,
) -> SnapshotResult:
    """抓每個變數在它適用的地點的序列並寫檔，最後依磁碟上的序列檔寫目錄檔。

    變數依 `source` 分派：`giovanni`、`nasa_power` 抓一般點位，`noaa_ghcnh` 抓有 `ghcnh_id` 的測站。
    對應的 client 沒給（None）就略過該來源，既有的序列檔照樣列在目錄檔。
    單一序列失敗不中斷整批，先前寫出的檔案保留；quota 用完時 Giovanni 之後的序列都不再送。
    """
    result = SnapshotResult()
    out_of_quota = False
    points = [
        loc for loc in locations if loc.get("kind") == "point" and "ghcnh_id" not in loc
    ]
    regions = [loc for loc in locations if loc.get("kind") == "region"]
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
    if harmony_client is not None:
        _area_series_batch(
            harmony_client,
            snapshot_dir,
            variables,
            regions,
            today,
            now,
            raw_dir,
            result,
            sleep,
        )
    variable_ids = {variable["id"] for variable in variables}
    location_ids = {location["id"] for location in locations}
    all_series = [
        series
        for series in _series_on_disk(snapshot_dir)
        if series.variable_id in variable_ids and series.location_id in location_ids
    ]
    catalog_variables = [_describe(variable, all_series) for variable in variables]
    refreshed = {path.name for path in result.written}
    result.not_updated = [
        (series.variable_id, series.location_id, series.aggregation)
        for series in all_series
        if Path(series.file).name not in refreshed
    ]
    result.written.append(
        write_catalog(
            snapshot_dir,
            catalog_variables,
            locations,
            all_series,
            generated_at=now,
            stamp=stamp,
        )
    )
    return result


def _area_series_batch(
    client: HarmonyClient,
    snapshot_dir: Path,
    variables: list[dict[str, Any]],
    regions: list[dict[str, Any]],
    today: date,
    now: str,
    raw_dir: Path | None,
    result: SnapshotResult,
    sleep: Callable[[float], None],
) -> None:
    """有 `harmony_collection` 的變數 × 每個區域，各送一個 Harmony job 取區域平均。

    job 是非同步的：分批送出、輪詢、下載。有 `raw_dir` 時把 job id 與結果 CSV 記在
    `raw_dir/harmony/`，中斷後同一天重跑會接著等原本的 job，已完成的直接讀 CSV 不重送。
    """
    point_series = [
        s for s in _series_on_disk(snapshot_dir) if s.aggregation == "point"
    ]
    units = {s.variable_id: s.unit for s in point_series}
    # Harmony 不接受早於產品第一筆的起始日（AIRS 2002-09、OMI 2004-10），
    # 所以用同變數點位序列最早有值的月份當起始日。
    first_months: dict[str, date] = {}
    for item in point_series:
        months = [p["month"] for p in item.points if p["value"] is not None]
        if months:
            first = date.fromisoformat(min(months))
            first_months[item.variable_id] = min(
                first, first_months.get(item.variable_id, first)
            )

    def start_for(variable: dict[str, Any]) -> date:
        return max(START_DATE, first_months.get(variable["id"], START_DATE))

    state_path = raw_dir / "harmony" / "jobs.json" if raw_dir else None
    state: dict[str, dict[str, str]] = {}
    if state_path is not None and state_path.exists():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except ValueError:
            state = {}

    def save_state() -> None:
        if state_path is not None:
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(
                json.dumps(state, indent=2, sort_keys=True), encoding="utf-8"
            )

    def finish(variable: dict[str, Any], region: dict[str, Any], text: str) -> None:
        key = (variable["id"], region["id"])
        try:
            parsed = parse_area_csv(text)
            if not any(value is not None for _, value in parsed.rows):
                raise HarmonyError("區域平均整條都是缺值")
            if variable["id"] not in units:
                raise HarmonyError(
                    "還沒有這個變數的點位序列，無法得知單位；請先抓 giovanni 來源"
                )
            to_points = (
                daily_to_monthly_points
                if variable["native_temporal_res"] == "day"
                else monthly_points
            )
            series = Series(
                variable_id=variable["id"],
                location_id=region["id"],
                aggregation="area_mean",
                unit=units[variable["id"]],
                source_api="harmony",
                request={
                    "collection": variable["harmony_collection"],
                    "variable": variable["source_variable_id"],
                    "bbox": region["bbox"],
                    "average": "area",
                    "format": "text/csv",
                    "start": f"{start_for(variable):%Y-%m-%d}",
                    "end_policy": "run_date",
                },
                retrieved_at=now,
                product_version=variable["product_version"],
                grid=None,
                points=to_points(parsed.rows),
            )
            result.written.append(write_series(snapshot_dir, series))
        except Exception as err:  # noqa: BLE001 單一序列不論何種失敗都不中斷整批
            result.failures[key] = f"{type(err).__name__}: {err}"
        else:
            result.succeeded.append(key)

    todo = [
        (variable, region)
        for variable in variables
        if variable["source"] == "giovanni" and variable.get("harmony_collection")
        for region in regions
        # 區域裡沒有這個產品的格點中心：job 一定失敗，不送也不算失敗
        if region["id"] not in variable.get("harmony_skip_regions", [])
    ]
    run_date = today.isoformat()
    waiting: list[tuple[dict[str, Any], dict[str, Any], str]] = []
    to_submit = []
    for variable, region in todo:
        name = f"{variable['id']}__{region['id']}"
        record = state.get(name, {})
        cached = raw_dir / "harmony" / f"{name}.csv" if raw_dir else None
        if record.get("end") != run_date:
            to_submit.append((variable, region))
        elif (
            record.get("status") == "successful"
            and cached is not None
            and cached.exists()
        ):
            finish(variable, region, cached.read_text(encoding="utf-8"))
        elif record.get("status") not in FINISHED and record.get("job_id"):
            waiting.append((variable, region, record["job_id"]))
        else:
            to_submit.append((variable, region))

    out_of_quota = False
    strikes: dict[str, int] = {}
    while waiting or to_submit:
        # 每次補送前查一次 quota；查不到就當作還有額度，交給送出本身報錯
        if to_submit and len(waiting) < HARMONY_BATCH and not out_of_quota:
            try:
                out_of_quota = client.quota() >= 0.95
            except HarmonyError:
                pass
        while to_submit and len(waiting) < HARMONY_BATCH:
            variable, region = to_submit.pop(0)
            key = (variable["id"], region["id"])
            name = f"{key[0]}__{key[1]}"
            try:
                if out_of_quota:
                    raise HarmonyError("quota 已達上限，未送出")
                job_id = client.submit(
                    variable["harmony_collection"],
                    variable["source_variable_id"],
                    bbox=region["bbox"],
                    start=start_for(variable),
                    end=today,
                )
            except Exception as err:  # noqa: BLE001
                result.failures[key] = f"{type(err).__name__}: {err}"
                continue
            state[name] = {
                "job_id": job_id,
                "end": run_date,
                "status": "running",
                "submitted_at": now,
            }
            save_state()
            waiting.append((variable, region, job_id))
        waited = 0.0
        while waiting:
            still: list[tuple[dict[str, Any], dict[str, Any], str]] = []
            for variable, region, job_id in waiting:
                key = (variable["id"], region["id"])
                name = f"{key[0]}__{key[1]}"
                try:
                    status, link, message = client.job(job_id)
                    text = None
                    if status == "successful" and link is not None:
                        text = client.download(link)
                except Exception as err:  # noqa: BLE001
                    # 輪詢或下載的暫時性錯誤：先當作還在跑，連續 3 次才放棄
                    strikes[job_id] = strikes.get(job_id, 0) + 1
                    if strikes[job_id] < 3:
                        still.append((variable, region, job_id))
                    else:
                        result.failures[key] = f"{type(err).__name__}: {err}"
                    continue
                strikes.pop(job_id, None)
                if status not in FINISHED:
                    still.append((variable, region, job_id))
                    continue
                if text is None:
                    state[name]["status"] = status
                    save_state()
                    result.failures[key] = (
                        f"HarmonyError: job {job_id} 結束狀態是 {status}：{message[:300]}"
                    )
                    continue
                if raw_dir is not None:
                    (raw_dir / "harmony" / f"{name}.csv").write_text(
                        text, encoding="utf-8"
                    )
                # 結果存好之後才記成 successful，下載失敗時下次會接著用同一個 job
                state[name]["status"] = status
                save_state()
                finish(variable, region, text)
            waiting = still
            # 有空位就先補送下一批，不必等整批結束
            if to_submit and len(waiting) < HARMONY_BATCH:
                break
            if waiting:
                if waited >= HARMONY_MAX_WAIT_SECONDS:
                    for variable, region, job_id in waiting:
                        result.failures[(variable["id"], region["id"])] = (
                            f"job {job_id} 等了 {HARMONY_MAX_WAIT_SECONDS} 秒仍未完成；同一天重跑會接著等"
                        )
                    waiting = []
                    break
                sleep(HARMONY_POLL_SECONDS)
                waited += HARMONY_POLL_SECONDS


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
    parser.add_argument("--lists-dir", type=Path, default=LISTS_DIR)
    parser.add_argument(
        "--source",
        choices=SOURCES,
        action="append",
        help="只重抓這個來源（可重複指定）；預設全部。其他來源的既有序列檔保留",
    )
    args = parser.parse_args(argv)
    sources = args.source or list(SOURCES)
    skipped: list[str] = []
    token = None
    if "giovanni" in sources or "harmony" in sources:
        try:
            token = read_secret(
                "EARTHDATA_TOKEN",
                args.env_file,
                how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
            )
        except SystemExit as err:
            # 沒有 token 不讓整份快照停擺：略過需要它的來源，其餘照跑，既有序列檔保留
            skipped = [name for name in ("giovanni", "harmony") if name in sources]
            print(f"略過 {'、'.join(skipped)}：{err}")
    variables, locations = load_seed(args.seed_dir)
    now = datetime.now(UTC)
    result = build_snapshot(
        GiovanniClient(token) if token and "giovanni" in sources else None,
        args.snapshot_dir,
        variables,
        locations,
        today=now.date(),
        now=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        raw_dir=args.raw_dir,
        station_http=httpx.Client(timeout=120) if "noaa_ghcnh" in sources else None,
        power_http=httpx.Client(timeout=120) if "nasa_power" in sources else None,
        harmony_client=HarmonyClient(token) if token and "harmony" in sources else None,
        # 快照日（generated_at）每次執行都更新，就算資料沒變
        stamp=True,
    )
    print(f"成功 {len(result.succeeded)} 條，失敗 {len(result.failures)} 條")
    for (variable_id, location_id), used in result.shifted.items():
        print(f"  內移 {variable_id} @ {location_id} → {used}")
    for (variable_id, location_id), reason in result.failures.items():
        print(f"  失敗 {variable_id} @ {location_id}：{reason}")
    if result.not_updated:
        print(f"這次沒有更新、沿用先前檔案的序列：{len(result.not_updated)} 條")
        by_variable: dict[str, int] = {}
        for variable_id, _, aggregation in result.not_updated:
            name = f"{variable_id}（{aggregation}）"
            by_variable[name] = by_variable.get(name, 0) + 1
        for name, count in sorted(by_variable.items()):
            print(f"  {name} × {count}")
    for path in write_lists(args.snapshot_dir, args.lists_dir, Path("pyproject.toml")):
        print(f"清單：{path}")
    return 1 if result.failures or skipped else 0


if __name__ == "__main__":
    sys.exit(main())
