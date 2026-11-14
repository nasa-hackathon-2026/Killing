"""NASA POWER 的月平均點位資料（免認證）。

回應的鍵是 `YYYYMM`，另有 `YYYY13` 是年平均（要排除）；缺值是 header 的 fill_value（-999）。
這裡用來取 MERRA-2 的 2 m 氣溫，當作 Giovanni `merra2_t2m` 的交叉驗證（#23）。
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

API_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
START_YEAR = 2001


class PowerError(RuntimeError):
    """NASA POWER 回傳非成功狀態或不合預期的內容。"""


@dataclass(frozen=True)
class PowerSeries:
    unit: str
    sources: list[str]
    api_version: str
    # POWER 回報的點位 [經度, 緯度, 高程]
    coordinates: list[float]
    rows: list[tuple[date, float | None]]


def query(parameter: str, *, lat: float, lon: float, end_year: int) -> dict[str, Any]:
    """查詢參數。POWER 的月資料只接受年份。"""
    return {
        "parameters": parameter,
        "community": "AG",
        "longitude": lon,
        "latitude": lat,
        "start": START_YEAR,
        "end": end_year,
        "format": "JSON",
    }


def fetch_monthly(http: httpx.Client, params: dict[str, Any]) -> dict[str, Any]:
    response = http.get(API_URL, params=params)
    if response.status_code >= 400:
        raise PowerError(
            f"NASA POWER → HTTP {response.status_code}: {response.text[:300]}"
        )
    try:
        return response.json()
    except ValueError as err:
        raise PowerError(f"NASA POWER 回應不是 JSON：{response.text[:200]!r}") from err


def parse_monthly(payload: dict[str, Any], parameter: str) -> PowerSeries:
    """讀出 (當月 1 號, 值)；年平均鍵（月份 13）排除，fill value 轉成 None。"""
    try:
        values: dict[str, float] = payload["properties"]["parameter"][parameter]
    except (KeyError, TypeError) as err:
        raise PowerError(f"回應裡沒有參數 {parameter}") from err
    header = payload.get("header", {})
    fill = header.get("fill_value", -999.0)
    rows: list[tuple[date, float | None]] = []
    for key in sorted(values):
        year, month = int(key[:4]), int(key[4:6])
        if not 1 <= month <= 12:
            continue
        value = values[key]
        rows.append((date(year, month, 1), None if value == fill else float(value)))
    return PowerSeries(
        unit=payload.get("parameters", {}).get(parameter, {}).get("units", ""),
        sources=list(header.get("sources", [])),
        api_version=header.get("api", {}).get("version", ""),
        coordinates=list(payload.get("geometry", {}).get("coordinates", [])),
        rows=rows,
    )
