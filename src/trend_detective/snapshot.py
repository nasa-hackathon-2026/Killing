"""重新產生靜態快照：抓取、轉成統一格式、寫出序列檔與目錄檔。

用法（在 repo 根目錄，`.env` 要有 `EARTHDATA_TOKEN`）：
    uv run python -m trend_detective.snapshot

目前只有 tracer bullet 的一條序列（台中 IMERG 月降水，#6）；
其餘變數與地點由 #8 之後的票加進 `VARIABLES`、`LOCATIONS`。
"""

import argparse
import sys
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from trend_detective.env import read_secret
from trend_detective.giovanni import GiovanniClient, parse_timeseries_csv
from trend_detective.series import Series, monthly_points, write_catalog, write_series

SNAPSHOT_DIR = Path("data/snapshot")
START_DATE = date(2001, 1, 1)

VARIABLES: list[dict[str, Any]] = [
    {
        "id": "imerg_precip",
        "name_zh": "降水",
        "name_en": "Precipitation (GPM IMERG Final)",
        "definition_zh": "從天空落到地面的雨和雪；這裡是整個月平均下來每小時下了幾毫米。",
        "category": "水（液態）",
        "unit": "mm/hr",
        "source": "giovanni",
        "source_variable_id": "GPM_3IMERGM_07_precipitation",
        "product_version": "07",
        "native_temporal_res": "month",
        "valid_from": "2001-01-01",
        # IMERG Final 只到 2025-09；之後的 Late 版算法不同，不可接續（#4 R5）
        "valid_to": "2025-09-01",
        "is_nasa": True,
        "doi": "10.5067/GPM/IMERG/3B-MONTH/07",
    }
]

LOCATIONS: list[dict[str, Any]] = [
    {
        "id": "taichung",
        "kind": "point",
        "name_zh": "臺中",
        "name_en": "Taichung",
        "lat": 24.15,
        "lon": 120.68,
    }
]


def build_snapshot(
    client: GiovanniClient, snapshot_dir: Path, *, today: date, now: str
) -> list[Path]:
    """抓每個變數在每個點位的序列並寫檔，回傳寫出的檔案路徑（目錄檔在最後）。"""
    written: list[Path] = []
    all_series: list[Series] = []
    for variable in VARIABLES:
        for location in LOCATIONS:
            text, request = client.fetch_timeseries(
                variable["source_variable_id"],
                lat=location["lat"],
                lon=location["lon"],
                start=START_DATE,
                end=today,
            )
            parsed = parse_timeseries_csv(text)
            series = Series(
                variable_id=variable["id"],
                location_id=location["id"],
                aggregation="point",
                unit=parsed.unit,
                source_api="giovanni",
                # 結束日每天不同，不記進 request，否則重跑會產生無意義的 diff；
                # 實際涵蓋範圍看 points 的起訖月。
                request={
                    "data": request["data"],
                    "location": request["location"],
                    "start": f"{START_DATE:%Y-%m-%d}",
                    "end": "latest",
                    "grid_lat": parsed.grid_lat,
                    "grid_lon": parsed.grid_lon,
                },
                retrieved_at=now,
                product_version=variable["product_version"],
                points=monthly_points(parsed.rows),
            )
            written.append(write_series(snapshot_dir, series))
            all_series.append(series)
    written.append(
        write_catalog(snapshot_dir, VARIABLES, LOCATIONS, all_series, generated_at=now)
    )
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="重新產生靜態快照")
    parser.add_argument("--snapshot-dir", type=Path, default=SNAPSHOT_DIR)
    parser.add_argument("--env-file", type=Path, default=Path(".env"))
    args = parser.parse_args(argv)
    token = read_secret(
        "EARTHDATA_TOKEN",
        args.env_file,
        how_to_get="到 Earthdata Login 的 Generate Token 頁產生 token",
    )
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    for path in build_snapshot(
        GiovanniClient(token), args.snapshot_dir, today=date.today(), now=now
    ):
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
