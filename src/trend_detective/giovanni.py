"""Giovanni Cloud API 的單點時間序列：抓取與 CSV 解析。

`/timeseries` 只支援單點，回傳 CSV：前段是 `key,value` 的 metadata，
空一行後才是 `Timestamp (UTC),Data` 的資料表（2026-11-14 實測，見 #5 留言）。
每次抓取前先查 `/quota`，用量達 0.95 就停（母票 #4）。
"""

import csv
import math
import threading
import time
from collections.abc import Callable
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
    # 網格解析度（度）；metadata 沒給就是 None
    lat_resolution: float | None
    lon_resolution: float | None
    # 缺值（metadata 的 undef）轉成 None
    rows: list[tuple[date, float | None]]
    # 來源對這個變數的英文說明；metadata 沒給就是空字串
    param_name: str = ""


def _optional_float(raw: str | None) -> float | None:
    try:
        return float(raw) if raw is not None else None
    except ValueError:
        return None


def _value(raw: str, undef: float | None) -> float | None:
    """空字串、NaN 與 fill value 都是缺值。fill value 以相對誤差比對，容忍 float32 展開。"""
    if raw.strip() == "":
        return None
    value = float(raw)
    if math.isnan(value):
        return None
    if undef is not None and math.isclose(value, undef, rel_tol=1e-6):
        return None
    return value


def parse_timeseries_csv(text: str) -> GiovanniSeries:
    """解析 `/timeseries` 的 CSV。以 `Timestamp` 開頭的表頭分界，不寫死行數。

    內容不合預期（沒有資料表、缺座標、值或時間無法解讀）一律丟 `GiovanniError`。
    """
    meta: dict[str, str] = {}
    table: list[list[str]] = []
    in_table = False
    for record in csv.reader(text.splitlines()):
        if not record:
            continue
        if in_table:
            table.append(record)
        elif record[0].startswith("Timestamp"):
            in_table = True
        elif len(record) >= 2:
            meta[record[0]] = ",".join(record[1:])
    if not in_table:
        raise GiovanniError(f"回應裡找不到資料表：{text[:200]!r}")
    try:
        undef = float(meta["undef"]) if "undef" in meta else None
        if undef is not None and math.isnan(undef):
            undef = None
        grid_lat, grid_lon = float(meta["lat"]), float(meta["lon"])
    except (KeyError, ValueError) as err:
        raise GiovanniError(f"metadata 缺少或無法解讀 {err}") from err
    rows: list[tuple[date, float | None]] = []
    for record in table:
        try:
            day = datetime.strptime(record[0], "%Y-%m-%d %H:%M").date()
            rows.append((day, _value(record[1], undef)))
        except (ValueError, IndexError) as err:
            raise GiovanniError(f"無法解讀資料列 {record!r}：{err}") from err
    return GiovanniSeries(
        unit=meta.get("unit", ""),
        grid_lat=grid_lat,
        grid_lon=grid_lon,
        product=meta.get("prod_name", ""),
        doi=meta.get("doi", ""),
        lat_resolution=_optional_float(meta.get("lat_resolution")),
        lon_resolution=_optional_float(meta.get("lon_resolution")),
        rows=rows,
        param_name=meta.get("param_name", ""),
    )


# 遇到這些狀態碼代表服務忙或限流，退避後重試
RETRY_STATUS = {429, 500, 502, 503, 504}


class GiovanniClient:
    """`quota_ttl`：`/quota` 的結果沿用幾秒。預設 0（每次抓取前都查）；大量平行抓取時設成
    幾十秒，quota 檢查才不會讓請求數加倍。`retries`：遇到 429、5xx 或連線錯誤時最多再試幾次，
    每次等待時間加倍。同一個 client 可以給多個執行緒共用。
    """

    def __init__(
        self,
        token: str,
        http: httpx.Client | None = None,
        *,
        quota_ttl: float = 0.0,
        retries: int = 0,
        backoff: float = 2.0,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._http = http or httpx.Client(base_url=API_URL, timeout=300)
        self._headers = {"Authorization": f"Bearer {token}"}
        self._quota_ttl = quota_ttl
        self._retries = retries
        self._backoff = backoff
        self._sleep = sleep
        self._clock = clock
        self._lock = threading.Lock()
        self._quota_cache: tuple[float, float] | None = None

    def _get(self, path: str, params: dict[str, str] | None = None) -> httpx.Response:
        for attempt in range(self._retries + 1):
            last = attempt == self._retries
            try:
                response = self._http.get(path, params=params, headers=self._headers)
            except httpx.TransportError as err:
                if last:
                    raise GiovanniError(
                        f"Giovanni GET {path} → {type(err).__name__}"
                    ) from err
            else:
                if response.status_code < 400:
                    return response
                if last or response.status_code not in RETRY_STATUS:
                    raise GiovanniError(
                        f"Giovanni GET {path} → HTTP {response.status_code}: {response.text[:300]}"
                    )
            self._sleep(self._backoff * 2**attempt)
        raise AssertionError("unreachable")

    def quota(self) -> float:
        """本月已用的 quota 比例（0–1）。`quota_ttl` 內重複呼叫沿用上次的結果。"""
        with self._lock:
            cached = self._quota_cache
            if cached is not None and self._clock() - cached[0] < self._quota_ttl:
                return cached[1]
            response = self._get("quota")
            try:
                used = float(response.json()["quota"])
            except (KeyError, TypeError, ValueError) as err:
                raise GiovanniError(
                    f"無法解讀 /quota 的回應：{response.text[:200]!r}"
                ) from err
            self._quota_cache = (self._clock(), used)
            return used

    def fetch_timeseries(
        self, variable: str, *, lat: float, lon: float, start: date, end: date
    ) -> tuple[str, dict[str, Any]]:
        """回傳 (CSV 文字, 實際送出的查詢參數)。參數不含憑證。"""
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
