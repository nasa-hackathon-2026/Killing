"""NOAA GHCNh（Global Historical Climatology Network – hourly）測站氣溫。

資料在 AWS Open Data，匿名 HTTPS 下載，一站一年一個 `|` 分隔的 PSV。
這裡只用 `temperature`（°C）：逐時 → 當地日的日平均 → 月平均。
repo 只放月平均；逐時原始檔留在 `data/raw/ghcnh/`，不進 git。
"""

import csv
from calendar import monthrange
from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

import httpx

BASE_URL = "https://noaa-ghcnh-pds.s3.amazonaws.com/hourly/access/by-year/"
# 當月有觀測的天數少於這個門檻，月平均記為缺值（#11）
MIN_DAYS_PER_MONTH = 20

Hourly = tuple[datetime, float]
Daily = tuple[date, float, int]


class GhcnhError(RuntimeError):
    """GHCNh 下載失敗。"""


def year_url(station_id: str, year: int) -> str:
    return f"{BASE_URL}{year}/psv/GHCNh_{station_id}_{year}.psv"


def fetch_year(http: httpx.Client, station_id: str, year: int) -> str | None:
    """下載一站一年的 PSV；該年沒有檔案（404）回傳 None。"""
    response = http.get(year_url(station_id, year))
    if response.status_code == 404:
        return None
    if response.status_code >= 400:
        raise GhcnhError(
            f"GHCNh {station_id} {year} → HTTP {response.status_code}: {response.text[:200]}"
        )
    return response.text


def parse_psv(text: str) -> list[Hourly]:
    """讀出每筆觀測的 (UTC 時間, 氣溫 °C)；沒有氣溫的列略過。欄位以表頭名稱為準。"""
    reader = csv.reader(text.splitlines(), delimiter="|")
    header = next(reader, [])
    try:
        date_index, temp_index = header.index("DATE"), header.index("temperature")
    except ValueError as err:
        raise ValueError(f"PSV 表頭缺少 DATE 或 temperature 欄：{err}") from err
    rows: list[Hourly] = []
    for record in reader:
        if (
            len(record) <= max(date_index, temp_index)
            or record[temp_index].strip() == ""
        ):
            continue
        rows.append(
            (datetime.fromisoformat(record[date_index]), float(record[temp_index]))
        )
    return rows


def hourly_to_daily(rows: list[Hourly], *, utc_offset_hours: int) -> list[Daily]:
    """依測站當地日期分組取平均，回傳 (日期, 日平均, 觀測筆數)，依日期排序。"""
    by_day: dict[date, list[float]] = defaultdict(list)
    for moment, value in rows:
        by_day[(moment + timedelta(hours=utc_offset_hours)).date()].append(value)
    return [
        (day, sum(values) / len(values), len(values))
        for day, values in sorted(by_day.items())
    ]


def station_monthly_points(
    daily: list[Daily], *, min_days: int = MIN_DAYS_PER_MONTH
) -> list[dict[str, Any]]:
    """日平均 → 月平均。`n_samples` 是有觀測的天數；天數不到 `min_days` 的月份 value 為 None。

    第一個與最後一個有資料的月份之間，完全沒有觀測的月份補成缺值，讓序列逐月連續。
    """
    by_month: dict[date, list[float]] = defaultdict(list)
    for day, value, _ in daily:
        by_month[day.replace(day=1)].append(value)
    if not by_month:
        return []
    points = []
    month, last = min(by_month), max(by_month)
    while month <= last:
        values = by_month.get(month, [])
        days_in_month = monthrange(month.year, month.month)[1]
        points.append(
            {
                "month": month.isoformat(),
                "value": sum(values) / len(values) if len(values) >= min_days else None,
                "n_samples": len(values),
                "coverage": len(values) / days_in_month,
            }
        )
        month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
    return points
