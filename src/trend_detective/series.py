"""統一格式（母票 #4）：轉月規則，以及序列檔與目錄檔的寫出。

重跑要冪等：鍵的順序固定；內容除了時間戳以外都相同時不改檔，`git diff` 為空。
"""

import json
from calendar import monthrange
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

Row = tuple[date, float | None]
Point = dict[str, Any]


@dataclass(frozen=True)
class Series:
    variable_id: str
    location_id: str
    aggregation: str
    unit: str
    source_api: str
    # 只記查詢參數，不得含 token
    request: dict[str, Any]
    retrieved_at: str
    product_version: str
    # 資料實際所在的網格中心（點位序列）；區域平均沒有就留 None
    grid: dict[str, float] | None
    points: list[Point]

    @property
    def file(self) -> str:
        return f"series/{self.variable_id}__{self.location_id}__{self.aggregation}.json"


def monthly_points(rows: list[Row]) -> list[Point]:
    """原本就是月資料：每月一點，有值時 n_samples = 1、coverage = 1；缺值時兩者為 0。"""
    points: list[Point] = []
    for day, value in sorted(rows, key=lambda row: row[0]):
        month = day.replace(day=1).isoformat()
        if points and points[-1]["month"] == month:
            raise ValueError(f"月資料在 {month[:7]} 出現不只一列")
        points.append(
            {
                "month": month,
                "value": value,
                "n_samples": 0 if value is None else 1,
                "coverage": 0 if value is None else 1,
            }
        )
    return points


def daily_to_monthly_points(rows: list[Row]) -> list[Point]:
    """日資料取當月有值日的平均；coverage = 有值天數 ÷ 當月天數。不剔除低覆蓋月份。"""
    by_month: dict[date, list[float]] = {}
    for day, value in rows:
        values = by_month.setdefault(day.replace(day=1), [])
        if value is not None:
            values.append(value)
    points = []
    for month in sorted(by_month):
        values = by_month[month]
        days_in_month = monthrange(month.year, month.month)[1]
        points.append(
            {
                "month": month.isoformat(),
                "value": sum(values) / len(values) if values else None,
                "n_samples": len(values),
                "coverage": len(values) / days_in_month,
            }
        )
    return points


def _write_unless_same(path: Path, content: dict[str, Any], *, ignore: str) -> None:
    """除了 `ignore` 指到的時間戳以外內容相同就不動檔案。`ignore` 可用 `a.b` 指巢狀鍵。"""

    def without_timestamp(data: dict[str, Any]) -> dict[str, Any]:
        copy = json.loads(json.dumps(data))
        *parents, leaf = ignore.split(".")
        target = copy
        for key in parents:
            target = target.get(key, {})
        target.pop(leaf, None)
        return copy

    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if without_timestamp(existing) == without_timestamp(content):
            return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(content, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def write_series(snapshot_dir: Path, series: Series) -> Path:
    """覆寫同一 (variable, location, aggregation) 的序列檔。"""
    path = snapshot_dir / series.file
    _write_unless_same(path, asdict(series), ignore="retrieved_at")
    return path


def write_catalog(
    snapshot_dir: Path,
    variables: list[dict[str, Any]],
    locations: list[dict[str, Any]],
    series: list[Series],
    *,
    generated_at: str,
) -> Path:
    """寫目錄檔：變數、地點、每條序列的檔名與起訖月，以及各變數的最新月份。"""
    entries = []
    # 沒有任何有值月份的變數記為 None，讓讀的人能分辨「沒資料」與「沒這個變數」
    latest: dict[str, str | None] = {}
    ordered = sorted(
        series, key=lambda s: (s.variable_id, s.location_id, s.aggregation)
    )
    for item in ordered:
        months = [point["month"] for point in item.points]
        entries.append(
            {
                "variable_id": item.variable_id,
                "location_id": item.location_id,
                "aggregation": item.aggregation,
                "file": item.file,
                "n_points": len(item.points),
                "first_month": min(months) if months else None,
                "last_month": max(months) if months else None,
            }
        )
        with_value = [p["month"] for p in item.points if p["value"] is not None]
        previous = latest.setdefault(item.variable_id, None)
        if with_value:
            latest[item.variable_id] = max(previous or "", max(with_value))
    catalog = {
        "variables": variables,
        "locations": locations,
        "series": entries,
        "snapshot": {"generated_at": generated_at, "latest_month": latest},
    }
    path = snapshot_dir / "catalog.json"
    _write_unless_same(path, catalog, ignore="snapshot.generated_at")
    return path
