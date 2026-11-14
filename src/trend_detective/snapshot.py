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
# 靠海點位被遮罩時，最多往內陸移幾格
MAX_INLAND_STEPS = 2

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
    for _ in range(MAX_INLAND_STEPS + 1):
        text, _request = client.fetch_timeseries(
            variable["source_variable_id"],
            lat=lat,
            lon=lon,
            start=START_DATE,
            end=today,
        )
        parsed = parse_timeseries_csv(text)
        if any(value is not None for _, value in parsed.rows):
            return text, parsed, [lat, lon]
        if not direction or not parsed.lat_resolution or not parsed.lon_resolution:
            break
        lat = round(lat + direction[0] * parsed.lat_resolution, 6)
        lon = round(lon + direction[1] * parsed.lon_resolution, 6)
    raise GiovanniError(f"格點被遮罩（整條都是缺值），最後嘗試的座標 [{lat},{lon}]")


def _existing_series(
    snapshot_dir: Path, variable_id: str, location_id: str
) -> Series | None:
    path = snapshot_dir / "series" / f"{variable_id}__{location_id}__point.json"
    if not path.exists():
        return None
    return Series(**json.loads(path.read_text(encoding="utf-8")))


def build_snapshot(
    client: GiovanniClient,
    snapshot_dir: Path,
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    *,
    today: date,
    now: str,
    raw_dir: Path | None = None,
) -> SnapshotResult:
    """抓每個變數在每個點位的序列並寫檔，最後寫目錄檔。

    抓取失敗的序列若先前已有檔案，檔案保留並照樣列在目錄檔。
    quota 用完時整批停止（已寫的檔案保留）。
    """
    result = SnapshotResult()
    all_series: list[Series] = []
    out_of_quota = False
    for variable in variables:
        for location in locations:
            key = (variable["id"], location["id"])
            try:
                if out_of_quota:
                    raise QuotaExceeded("quota 已達上限，未抓取")
                text, parsed, used = _fetch_unmasked(client, variable, location, today)
            except QuotaExceeded as err:
                out_of_quota = True
                result.failures[key] = str(err)
            except (GiovanniError, httpx.HTTPError) as err:
                result.failures[key] = str(err)
            else:
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
                    result.shifted[key] = used
                to_points = (
                    daily_to_monthly_points
                    if variable["native_temporal_res"] == "day"
                    else monthly_points
                )
                series = Series(
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
                if raw_dir is not None:
                    raw_path = raw_dir / "giovanni" / f"{key[0]}__{key[1]}.csv"
                    raw_path.parent.mkdir(parents=True, exist_ok=True)
                    raw_path.write_text(text, encoding="utf-8")
                result.written.append(write_series(snapshot_dir, series))
                result.succeeded.append(key)
                all_series.append(series)
                continue
            previous = _existing_series(snapshot_dir, *key)
            if previous is not None:
                all_series.append(previous)
    catalog_variables = [_describe(variable, all_series) for variable in variables]
    result.written.append(
        write_catalog(
            snapshot_dir, catalog_variables, locations, all_series, generated_at=now
        )
    )
    return result


def _describe(variable: dict[str, Any], all_series: list[Series]) -> dict[str, Any]:
    """目錄檔的變數條目：seed 的說明，加上從資料得到的單位與有效期間。"""
    own = [s for s in all_series if s.variable_id == variable["id"]]
    months = [p["month"] for s in own for p in s.points if p["value"] is not None]
    return {
        **variable,
        "unit": own[0].unit if own else None,
        "valid_from": min(months) if months else None,
        "valid_to": max(months) if months else None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="重新產生靜態快照")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--seed-dir", type=Path, default=SEED_DIR)
    parser.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args(argv)
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    variables, locations = load_seed(args.seed_dir)
    now = datetime.now(UTC)
    result = build_snapshot(
        GiovanniClient(token),
        args.snapshot_dir,
        variables,
        locations,
        today=now.date(),
        now=now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        raw_dir=args.raw_dir,
    )
    print(f"成功 {len(result.succeeded)} 條，失敗 {len(result.failures)} 條")
    for (variable_id, location_id), used in result.shifted.items():
        print(f"  內移 {variable_id} @ {location_id} → {used}")
    for (variable_id, location_id), reason in result.failures.items():
        print(f"  失敗 {variable_id} @ {location_id}：{reason}")
    return 1 if result.failures else 0


if __name__ == "__main__":
    sys.exit(main())
