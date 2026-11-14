"""Giovanni Cloud API 的單點時間序列：抓取與 CSV 解析。

`/timeseries` 只支援單點，回傳 CSV：前段是 `key,value` 的 metadata，
空一行後才是 `Timestamp (UTC),Data` 的資料表（2026-11-14 實測，見 #5 留言）。
每次抓取前先查 `/quota`，用量達 0.95 就停（母票 #4）。
"""

import csv
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx

API_URL = "https://api.giovanni.earthdata.nasa.gov/"
QUOTA_LIMIT = 0.95


class GiovanniError(RuntimeError):
    """Giovanni 回傳非成功狀態或無法解析的內容。訊息不含憑證。"""


class QuotaExceeded(GiovanniError):
    """本月 quota 用量已達上限，不再送出抓取請求。"""


@dataclass(frozen=True)
class GiovanniSeries:
    unit: str
    # 資料實際所在的網格中心，可能與請求的座標不同
    grid_lat: float
    grid_lon: float
    product: str
    doi: str
    # 缺值（metadata 的 undef）轉成 None
    rows: list[tuple[date, float | None]]


def parse_timeseries_csv(text: str) -> GiovanniSeries:
    """解析 `/timeseries` 的 CSV。以 `Timestamp` 開頭的表頭分界，不寫死行數。"""
    meta: dict[str, str] = {}
    rows: list[tuple[date, float | None]] = []
    in_table = False
    for record in csv.reader(text.splitlines()):
        if not record:
            continue
        if not in_table:
            if record[0].startswith("Timestamp"):
                in_table = True
            elif len(record) >= 2:
                meta[record[0]] = ",".join(record[1:])
            continue
        rows.append(
            (datetime.strptime(record[0], "%Y-%m-%d %H:%M").date(), float(record[1]))
        )
    if not in_table:
        raise GiovanniError(f"回應裡找不到資料表：{text[:200]!r}")
    undef = float(meta["undef"]) if "undef" in meta else None
    return GiovanniSeries(
        unit=meta.get("unit", ""),
        grid_lat=float(meta["lat"]),
        grid_lon=float(meta["lon"]),
        product=meta.get("prod_name", ""),
        doi=meta.get("doi", ""),
        rows=[(day, None if value == undef else value) for day, value in rows],
    )


class GiovanniClient:
    def __init__(self, token: str, http: httpx.Client | None = None) -> None:
        self._http = http or httpx.Client(base_url=API_URL, timeout=120)
        self._headers = {"Authorization": f"Bearer {token}"}

    def _get(self, path: str, params: dict[str, str] | None = None) -> httpx.Response:
        response = self._http.get(path, params=params, headers=self._headers)
        if response.status_code >= 400:
            raise GiovanniError(
                f"Giovanni GET {path} → HTTP {response.status_code}: {response.text[:300]}"
            )
        return response

    def quota(self) -> float:
        """本月已用的 quota 比例（0–1）。"""
        return float(self._get("quota").json()["quota"])

    def fetch_timeseries(
        self, variable: str, *, lat: float, lon: float, start: date, end: date
    ) -> tuple[str, dict[str, Any]]:
        """回傳 (CSV 文字, 查詢參數)。查詢參數可直接記進序列檔的 `request`。"""
        used = self.quota()
        if used >= QUOTA_LIMIT:
            raise QuotaExceeded(
                f"Giovanni quota 已用 {used:.2f}，達 {QUOTA_LIMIT} 上限"
            )
        time = f"{start:%Y-%m-%d}T00:00:00/{end:%Y-%m-%d}T23:59:59"
        response = self._get(
            "timeseries",
            {"data": variable, "location": f"[{lat},{lon}]", "time": time},
        )
        return response.text, {"data": variable, "location": [lat, lon], "time": time}
