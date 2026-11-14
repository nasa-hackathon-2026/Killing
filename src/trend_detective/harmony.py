"""Harmony 上的 Giovanni Averaging Service：bbox 的區域平均時間序列。

Giovanni `/timeseries` 只支援單點，區域平均要走 Harmony 的非同步 job：
送出 → 輪詢 `/jobs/<id>` → 下載結果 CSV。認證用 EDL token（`EARTHDATA_TOKEN`）。
結果 CSV 的開頭是 `名稱:,值` 的屬性，遇到只有 `,` 的一行結束，之後是 `time,mean_<變數>`
（2026-11-14 實測；單一 job 約 86 秒，quota 消耗約 4e-7）。
"""

import csv
import math
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx

API_URL = "https://harmony.earthdata.nasa.gov/"
QUOTA_URL = "https://api.giovanni.earthdata.nasa.gov/quota"
FINISHED = {"successful", "failed", "canceled", "complete_with_errors"}


class HarmonyError(RuntimeError):
    """Harmony 回傳非成功狀態或無法解讀的內容。訊息不含憑證。"""


@dataclass(frozen=True)
class AreaSeries:
    column: str
    # W, S, E, N；回應沒有就是空 list
    bbox: list[float]
    rows: list[tuple[date, float | None]]


def parse_area_csv(text: str) -> AreaSeries:
    """解析區域平均的結果 CSV；fill value 與空值轉成 None。"""
    attrs: dict[str, str] = {}
    lines = text.splitlines()
    try:
        split = next(i for i, line in enumerate(lines) if line.strip() == ",")
    except StopIteration as err:
        raise HarmonyError(
            f"結果 CSV 找不到屬性與資料的分隔行：{text[:200]!r}"
        ) from err
    for record in csv.reader(lines[:split]):
        if len(record) >= 2:
            attrs[record[0].rstrip(":")] = record[1]
    table = list(csv.reader(lines[split + 1 :]))
    if not table or len(table[0]) < 2 or table[0][0] != "time":
        raise HarmonyError(
            f"結果 CSV 的表頭不是 time,mean_…：{lines[split + 1 : split + 2]!r}"
        )
    try:
        fill = float(attrs["Fill Value"]) if "Fill Value" in attrs else None
        bbox = [
            float(part)
            for part in attrs.get("User Bounding Box", "").split(",")
            if part.strip()
        ]
        rows: list[tuple[date, float | None]] = []
        for record in table[1:]:
            if not record:
                continue
            day = datetime.fromisoformat(record[0]).date()
            raw = record[1].strip() if len(record) > 1 else ""
            value = float(raw) if raw else None
            if value is not None and (
                math.isnan(value)
                or (fill is not None and math.isclose(value, fill, rel_tol=1e-6))
            ):
                value = None
            rows.append((day, value))
    except ValueError as err:
        raise HarmonyError(f"結果 CSV 的內容無法解讀：{err}") from err
    return AreaSeries(column=table[0][1], bbox=bbox, rows=rows)


class HarmonyClient:
    def __init__(self, token: str, http: httpx.Client | None = None) -> None:
        self._http = http or httpx.Client(
            base_url=API_URL, timeout=120, follow_redirects=True
        )
        self._headers = {"Authorization": f"Bearer {token}"}

    def _get(self, url: str, params: Any = None) -> httpx.Response:
        response = self._http.get(url, params=params, headers=self._headers)
        if response.status_code >= 400:
            raise HarmonyError(
                f"Harmony GET {url} → HTTP {response.status_code}: {response.text[:300]}"
            )
        return response

    def _json(self, response: httpx.Response) -> dict[str, Any]:
        try:
            return response.json()
        except ValueError as err:
            raise HarmonyError(
                f"Harmony 回應不是 JSON：{response.text[:200]!r}"
            ) from err

    def quota(self) -> float:
        """Giovanni 本月已用的 quota 比例；區域平均與單點共用同一份。"""
        try:
            return float(self._json(self._get(QUOTA_URL))["quota"])
        except (KeyError, TypeError, ValueError) as err:
            raise HarmonyError("無法解讀 /quota 的回應") from err

    def submit(
        self,
        concept_id: str,
        variable: str,
        *,
        bbox: list[float],
        start: date,
        end: date,
    ) -> str:
        """送出一個區域平均 job，回傳 job id。`bbox` 是 W, S, E, N。"""
        west, south, east, north = bbox
        params = [
            ("subset", f"lat({south}:{north})"),
            ("subset", f"lon({west}:{east})"),
            (
                "subset",
                f'time("{start:%Y-%m-%d}T00:00:00Z":"{end:%Y-%m-%d}T23:59:59Z")',
            ),
            ("variable", variable),
            ("format", "text/csv"),
            ("average", "area"),
        ]
        path = f"{concept_id}/ogc-api-coverages/1.0.0/collections/parameter_vars/coverage/rangeset"
        body = self._json(self._get(path, params))
        if "jobID" not in body:
            raise HarmonyError(f"送出後沒有拿到 jobID：{str(body)[:200]}")
        return body["jobID"]

    def job(self, job_id: str) -> tuple[str, str | None, str]:
        """回傳 (狀態, 結果檔連結, 訊息)；還沒有結果時連結是 None。失敗原因在訊息裡。"""
        body = self._json(self._get(f"jobs/{job_id}"))
        links = [
            link["href"] for link in body.get("links", []) if link.get("rel") == "data"
        ]
        return (
            body.get("status", ""),
            links[0] if links else None,
            str(body.get("message", "")),
        )

    def download(self, url: str) -> str:
        return self._get(url).text
