"""把 AppEEARS area request 的統計 CSV 轉成區域月序列的點（#10）。

統計 CSV 每列是一個 layer × 區域（aid）× 合成期的統計量，數值已套用 scale factor
（NDVI 無單位、LST 為 K）。區域代碼 aid0001、aid0002… 依請求 GeoJSON 的 feature 順序。
"""

import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any


@dataclass(frozen=True)
class StatRow:
    dataset: str
    aid: str
    # 合成期的起始日
    day: date
    # 區域內有值的像元數
    count: int
    mean: float | None
    standard_deviation: float | None
    minimum: float | None
    maximum: float | None
    median: float | None


def _number(raw: str | None) -> float | None:
    text = (raw or "").strip()
    return float(text) if text else None


def parse_statistics_csv(text: str) -> list[StatRow]:
    """讀出每列的 layer、區域代碼、起始日與統計量。欄位以表頭名稱為準。"""
    reader = csv.DictReader(text.splitlines())
    required = {"Dataset", "aid", "Date", "Count", "Mean"}
    missing = required - set(reader.fieldnames or [])
    if missing:
        raise ValueError(f"統計 CSV 缺少欄位：{sorted(missing)}")
    rows = []
    for line_number, record in enumerate(reader, start=2):
        try:
            rows.append(
                StatRow(
                    dataset=record["Dataset"],
                    aid=record["aid"],
                    day=date.fromisoformat(record["Date"][:10]),
                    count=int(_number(record["Count"]) or 0),
                    mean=_number(record["Mean"]),
                    standard_deviation=_number(record.get("Standard Deviation")),
                    minimum=_number(record.get("Minimum")),
                    maximum=_number(record.get("Maximum")),
                    median=_number(record.get("Median")),
                )
            )
        except ValueError as err:
            raise ValueError(f"統計 CSV 第 {line_number} 行無法解讀：{err}") from err
    return rows


def region_ids_by_aid(request_json: str) -> dict[str, str]:
    """由 bundle 裡的請求 JSON 得到 aid → 區域 id（feature 的 `properties.id`）。"""
    features = json.loads(request_json)["params"]["geo"]["features"]
    return {
        f"aid{index:04d}": feature["properties"]["id"]
        for index, feature in enumerate(features, start=1)
    }


def composites_to_monthly_points(rows: list[StatRow]) -> list[dict[str, Any]]:
    """同一區域、同一 layer 的合成期 → 月序列的點。

    合成期依起始日歸月後取平均（月合成每月一筆，8 日合成每月 3–4 筆）。
    `n_samples` 是當月有值的合成期數；`coverage` 是當月各合成期「有值像元數 ÷ 這個區域
    出現過的最大像元數」的平均，沒有值的合成期算 0。不剔除低覆蓋的月份。
    """
    full = max((row.count for row in rows), default=0)
    by_month: dict[date, list[StatRow]] = defaultdict(list)
    for row in rows:
        by_month[row.day.replace(day=1)].append(row)
    points = []
    for month in sorted(by_month):
        composites = by_month[month]
        valid = [
            row.mean for row in composites if row.mean is not None and row.count > 0
        ]
        covered = [
            row.count / full if row.mean is not None and full else 0.0
            for row in composites
        ]
        points.append(
            {
                "month": month.isoformat(),
                "value": sum(valid) / len(valid) if valid else None,
                "n_samples": len(valid),
                "coverage": sum(covered) / len(covered),
            }
        )
    return points
