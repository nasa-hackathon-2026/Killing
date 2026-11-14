"""NOAA GHCNm v4（Global Historical Climatology Network – Monthly）測站月均溫。

資料在 NCEI 的 `https://www.ncei.noaa.gov/pub/data/ghcn/v4/`：`ghcnm.tavg.latest.qcf.tar.gz`
（QCF：品管加 PHA 均一化調整）與 `ghcnm.tavg.latest.qcu.tar.gz`（QCU：只品管、不調整），
各含一個 `.dat`（固定欄寬，一站一年一列、12 個月的值與旗標）與一個 `.inv`（測站座標）。
欄位位置以同目錄的 `readme.txt` 為準（2.1.1 與 2.2.1 節）。

用途是當氣溫的實測參考：為每個點位地點找最近、且 2001–2025 有足夠月數的測站，
把整個測站的月序列（全部年份）寫成統一格式（`series.py`）。原始檔與輸出都不進 git。

    python -m trend_detective.ghcnm download --raw-dir data/raw/ghcnm
    python -m trend_detective.ghcnm build --raw-dir data/raw/ghcnm --out-dir data/observed/ghcnm
"""

import argparse
import io
import json
import math
import re
import tarfile
from collections import Counter
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx

from trend_detective.series import (
    Series,
    _write_unless_same,  # pyright: ignore[reportPrivateUsage]
    write_catalog,
    write_series,
)

BASE_URL = "https://www.ncei.noaa.gov/pub/data/ghcn/v4/"
SOURCE_API = "noaa_ghcnm"
ARCHIVES = {
    "qcf": "ghcnm.tavg.latest.qcf.tar.gz",
    "qcu": "ghcnm.tavg.latest.qcu.tar.gz",
}
DOCS = ("readme.txt", "ghcnm-flags.txt", "status.txt", "ghcnm-countries.txt")
SEED_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "seed" / "sources" / "ghcnm.json"
)

VARIABLE_BY_PRODUCT = {"qcf": "ghcnm_tavg", "qcu": "ghcnm_tavg_unadj"}

WINDOW = (date(2001, 1, 1), date(2025, 12, 1))
MIN_MONTHS = 240
MAX_DISTANCE_KM = 100.0
# readme 2.2.1：QCFLAG 空白是沒有失敗；QCF 的 A 是「改用另一種調整方法」，值有效。
# 其餘旗標（QCU 的 E D R K W I L O S T M，QCF 的 M X，以及 readme 沒寫的 Q）一律不採用。
ACCEPTED_QC_FLAGS = frozenset({" ", "A"})
ELEMENT = "TAVG"
MISSING = -9999
EARTH_RADIUS_KM = 6371.0088
LINE_WIDTH = 115


class GhcnmError(RuntimeError):
    """GHCNm 下載或建置失敗。"""


@dataclass(frozen=True)
class Station:
    id: str
    lat: float
    lon: float
    elevation_m: float | None
    name: str


@dataclass(frozen=True)
class Reading:
    """一個月的值（°C，缺值為 None）與三個旗標字元。"""

    value: float | None
    dm_flag: str
    qc_flag: str
    ds_flag: str


@dataclass(frozen=True)
class Candidate:
    station: Station
    distance_km: float
    n_months: int


@dataclass(frozen=True)
class Match:
    location_id: str
    station: Station | None
    distance_km: float | None
    elevation_diff_m: float | None
    reason: str | None
    # 距離上限內的測站，由近到遠
    candidates: list[Candidate]
    # 全部測站裡最近的一個（找不到符合時用來說明差多遠）
    nearest_any: tuple[Station, float] | None


def parse_inventory(text: str) -> list[Station]:
    """`.inv`：ID 1-11、緯度 13-20、經度 22-30、高度 32-37（-999.0 為缺值）、站名 39-68。"""
    stations = []
    for line in text.splitlines():
        if not line.strip():
            continue
        elevation = float(line[31:37])
        stations.append(
            Station(
                id=line[0:11],
                lat=float(line[12:20]),
                lon=float(line[21:30]),
                elevation_m=None if elevation <= -999 else elevation,
                name=line[38:68].strip(),
            )
        )
    return stations


def parse_data_line(line: str) -> tuple[str, int, list[Reading]]:
    """`.dat` 一列：ID 1-11、年 12-15、要素 16-19，之後 12 組「值 5 碼＋3 個旗標」。"""
    line = line.rstrip("\n")
    if len(line) != LINE_WIDTH:
        raise ValueError(
            f"GHCNm 資料列應為 {LINE_WIDTH} 字元，實際 {len(line)}：{line[:19]!r}"
        )
    if line[15:19] != ELEMENT:
        raise ValueError(f"只處理 {ELEMENT}，這一列是 {line[15:19]!r}")
    readings = []
    for month in range(12):
        start = 19 + 8 * month
        raw = int(line[start : start + 5])
        readings.append(
            Reading(
                value=None if raw == MISSING else raw / 100.0,
                dm_flag=line[start + 5],
                qc_flag=line[start + 6],
                ds_flag=line[start + 7],
            )
        )
    return line[0:11], int(line[11:15]), readings


def usable_value(reading: Reading) -> float | None:
    """缺值、或 QC 旗標不在 `ACCEPTED_QC_FLAGS` 的月份回傳 None。"""
    if reading.value is None or reading.qc_flag not in ACCEPTED_QC_FLAGS:
        return None
    return reading.value


def read_records(
    lines: Iterable[str], wanted: set[str]
) -> dict[str, dict[date, Reading]]:
    """只解析 `wanted` 裡的測站（先看前 11 字元，其他列不解析），回傳 {站號: {月: Reading}}。"""
    records: dict[str, dict[date, Reading]] = {}
    for line in lines:
        if line[0:11] not in wanted:
            continue
        station_id, year, readings = parse_data_line(line)
        months = records.setdefault(station_id, {})
        for number, reading in enumerate(readings, start=1):
            month = date(year, number, 1)
            if month in months:
                raise ValueError(f"測站 {station_id} 的 {month:%Y-%m} 出現不只一列")
            months[month] = reading
    return records


def usable_values(
    months: dict[date, Reading], *, year: int | None = None
) -> dict[date, float]:
    values = {}
    for month, reading in months.items():
        if year is not None and month.year != year:
            continue
        value = usable_value(reading)
        if value is not None:
            values[month] = value
    return values


def qc_flag_counts(months: dict[date, Reading]) -> dict[str, int]:
    """非空白的 QC 旗標各出現幾個月（含值為缺值的月份，例如 QCF 的 X）。"""
    counts = Counter(r.qc_flag for r in months.values() if r.qc_flag != " ")
    return dict(sorted(counts.items()))


def months_in_window(values: dict[date, float], start: date, end: date) -> int:
    return sum(1 for month in values if start <= month <= end)


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """大圓距離（haversine，地球半徑 6371.0088 km）。"""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((phi2 - phi1) / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def stations_within(
    location: dict[str, Any], stations: Iterable[Station], max_km: float
) -> list[tuple[Station, float]]:
    """距離上限內的測站，由近到遠。"""
    found = []
    for station in stations:
        km = distance_km(location["lat"], location["lon"], station.lat, station.lon)
        if km <= max_km:
            found.append((station, km))
    return sorted(found, key=lambda pair: (pair[1], pair[0].id))


def match_location(
    location: dict[str, Any],
    stations: list[Station],
    window_counts: dict[str, int],
    *,
    max_km: float = MAX_DISTANCE_KM,
    min_months: int = MIN_MONTHS,
) -> Match:
    """距離上限內、視窗內有值月數 ≥ `min_months` 的測站裡，最近的一個。"""
    within = stations_within(location, stations, max_km)
    candidates = [
        Candidate(station, km, window_counts.get(station.id, 0))
        for station, km in within
    ]
    nearest_any = None
    if not within and stations:
        nearest_any = min(
            (
                (s, distance_km(location["lat"], location["lon"], s.lat, s.lon))
                for s in stations
            ),
            key=lambda pair: pair[1],
        )
    chosen = next((c for c in candidates if c.n_months >= min_months), None)
    if chosen is None:
        reason = (
            "no_station_with_enough_months"
            if candidates
            else "no_station_within_distance"
        )
        return Match(location["id"], None, None, None, reason, candidates, nearest_any)
    location_elevation = location.get("elevation_m")
    elevation_diff = (
        None
        if location_elevation is None or chosen.station.elevation_m is None
        else chosen.station.elevation_m - location_elevation
    )
    return Match(
        location["id"],
        chosen.station,
        chosen.distance_km,
        elevation_diff,
        None,
        candidates,
        nearest_any,
    )


def monthly_points(values: dict[date, float]) -> list[dict[str, Any]]:
    """月值本身：有值的月份才有一點（缺月不補），`n_samples = 1`、`coverage = 1.0`。"""
    return [
        {"month": month.isoformat(), "value": value, "n_samples": 1, "coverage": 1.0}
        for month, value in sorted(values.items())
    ]


def version_from_member(name: str) -> str:
    """從壓縮檔內的路徑取版本，例如 `ghcnm.v4.0.1.20261113/…` → `v4.0.1.20261113`。"""
    found = re.search(r"ghcnm\.(v\d+\.\d+\.\d+\.\d{8})/", name)
    if found is None:
        raise ValueError(f"壓縮檔內的路徑看不出版本：{name!r}")
    return found.group(1)


@contextmanager
def open_member(archive: Path, suffix: str) -> Iterator[tuple[str, Iterator[str]]]:
    """串流讀壓縮檔裡副檔名是 `suffix`（`.dat` 或 `.inv`）的成員，回傳 (成員路徑, 逐行)。"""
    with tarfile.open(archive, "r:gz") as tar:
        member = next((m for m in tar if m.isfile() and m.name.endswith(suffix)), None)
        if member is None:
            raise GhcnmError(f"{archive.name} 裡沒有 {suffix} 檔")
        handle = tar.extractfile(member)
        assert handle is not None
        yield member.name, iter(io.TextIOWrapper(handle, encoding="utf-8"))


def _station_json(station: Station) -> dict[str, Any]:
    return {
        "id": station.id,
        "name": station.name,
        "lat": station.lat,
        "lon": station.lon,
        "elevation_m": station.elevation_m,
    }


def _series_request(
    *,
    product: str,
    match: Match,
    months: dict[date, Reading],
    values: dict[date, float],
    window: tuple[date, date],
    min_months: int,
    max_km: float,
) -> dict[str, Any]:
    assert match.station is not None and match.distance_km is not None
    request: dict[str, Any] = {
        "archive": f"{BASE_URL}{ARCHIVES[product]}",
        "element": ELEMENT,
        "product": product.upper(),
        "station_id": match.station.id,
        "station_name": match.station.name,
        "station_lat": match.station.lat,
        "station_lon": match.station.lon,
        "station_elevation_m": match.station.elevation_m,
        "distance_km": round(match.distance_km, 2),
        "match_rule": {
            "max_distance_km": max_km,
            "min_months_in_window": min_months,
            "window": [window[0].isoformat()[:7], window[1].isoformat()[:7]],
            "months_in_window_qcf": next(
                c.n_months for c in match.candidates if c.station == match.station
            ),
        },
        "accepted_qc_flags": sorted(ACCEPTED_QC_FLAGS),
        "n_months_with_value": len(values),
        "n_months_with_value_in_window": months_in_window(values, *window),
        "n_months_excluded_by_qc_flag": sum(
            1
            for r in months.values()
            if r.value is not None and r.qc_flag not in ACCEPTED_QC_FLAGS
        ),
        "qc_flag_counts": qc_flag_counts(months),
        "n_months_with_dm_flag": sum(1 for r in months.values() if r.dm_flag != " "),
    }
    if match.elevation_diff_m is not None:
        request["elevation_diff_m"] = match.elevation_diff_m
    return request


def build(
    raw_dir: Path,
    out_dir: Path,
    locations: list[dict[str, Any]],
    *,
    retrieved_at: str,
    variables: list[dict[str, Any]] | None = None,
    min_months: int = MIN_MONTHS,
    max_km: float = MAX_DISTANCE_KM,
    window: tuple[date, date] = WINDOW,
) -> dict[str, Any]:
    """配站、寫序列檔、目錄檔與 `stations.json`。回傳配到與沒配到的地點 id。"""
    points = [loc for loc in locations if loc.get("kind") == "point"]
    with open_member(raw_dir / ARCHIVES["qcf"], ".inv") as (_, lines):
        stations = parse_inventory("".join(lines))
    candidates_by_location = {
        loc["id"]: stations_within(loc, stations, max_km) for loc in points
    }
    wanted = {s.id for found in candidates_by_location.values() for s, _ in found}

    with open_member(raw_dir / ARCHIVES["qcf"], ".dat") as (member, lines):
        version = version_from_member(member)
        qcf_records = read_records(lines, wanted)
    qcf_values = {sid: usable_values(months) for sid, months in qcf_records.items()}
    window_counts = {
        sid: months_in_window(values, *window) for sid, values in qcf_values.items()
    }
    matches = [
        match_location(
            loc, stations, window_counts, max_km=max_km, min_months=min_months
        )
        for loc in points
    ]
    matched_ids = {m.station.id for m in matches if m.station is not None}
    with open_member(raw_dir / ARCHIVES["qcu"], ".dat") as (qcu_member, lines):
        if version_from_member(qcu_member) != version:
            raise GhcnmError("QCF 與 QCU 的檔內版本不同")
        qcu_records = read_records(lines, matched_ids)
    qcu_values = {sid: usable_values(months) for sid, months in qcu_records.items()}

    variable_defs: list[dict[str, Any]] = (
        variables
        if variables is not None
        else json.loads(SEED_PATH.read_text(encoding="utf-8"))["variables"]
    )
    by_id = {v["id"]: v for v in variable_defs}
    written: list[Series] = []
    report: list[dict[str, Any]] = []
    for location, match in zip(points, matches, strict=True):
        row: dict[str, Any] = {
            "location_id": location["id"],
            "lat": location["lat"],
            "lon": location["lon"],
            "matched": match.station is not None,
            "reason": match.reason,
            "station": None if match.station is None else _station_json(match.station),
            "distance_km": None
            if match.distance_km is None
            else round(match.distance_km, 2),
            "elevation_diff_m": match.elevation_diff_m,
            "n_months_window_qcf": None,
            "n_months_window_qcu": None,
            "candidates_within_limit": [
                {
                    "id": c.station.id,
                    "name": c.station.name,
                    "distance_km": round(c.distance_km, 2),
                    "n_months_window_qcf": c.n_months,
                }
                for c in match.candidates[:5]
            ],
            "nearest_station_overall": None
            if match.nearest_any is None
            else {
                "id": match.nearest_any[0].id,
                "name": match.nearest_any[0].name,
                "distance_km": round(match.nearest_any[1], 2),
            },
        }
        report.append(row)
        if match.station is None:
            continue
        station_id = match.station.id
        row["n_months_window_qcf"] = window_counts[station_id]
        row["n_months_window_qcu"] = months_in_window(
            qcu_values.get(station_id, {}), *window
        )
        for product, records, values in (
            ("qcf", qcf_records, qcf_values),
            ("qcu", qcu_records, qcu_values),
        ):
            if station_id not in records:
                row.setdefault("missing_products", []).append(product)
                continue
            variable = by_id[VARIABLE_BY_PRODUCT[product]]
            series = Series(
                variable_id=variable["id"],
                location_id=location["id"],
                aggregation="point",
                unit="degC",
                source_api=SOURCE_API,
                request=_series_request(
                    product=product,
                    match=match,
                    months=records[station_id],
                    values=values[station_id],
                    window=window,
                    min_months=min_months,
                    max_km=max_km,
                ),
                retrieved_at=retrieved_at,
                product_version=f"GHCNm {version} {product.upper()}",
                grid=None,
                points=monthly_points(values[station_id]),
            )
            write_series(out_dir, series)
            written.append(series)

    matched_locations = [
        {k: v for k, v in loc.items() if k not in ("geojson", "bbox")}
        for loc, m in zip(points, matches, strict=True)
        if m.station is not None
    ]
    write_catalog(
        out_dir, variable_defs, matched_locations, written, generated_at=retrieved_at
    )
    _write_unless_same(
        out_dir / "stations.json",
        {
            "source": SOURCE_API,
            "product_version": version,
            "retrieved_at": retrieved_at,
            "rule": {
                "max_distance_km": max_km,
                "min_months_in_window_qcf": min_months,
                "window": [window[0].isoformat()[:7], window[1].isoformat()[:7]],
                "distance": "great-circle (haversine), location lat/lon from data/seed",
                "accepted_qc_flags": sorted(ACCEPTED_QC_FLAGS),
            },
            "n_locations": len(points),
            "n_matched": sum(1 for m in matches if m.station is not None),
            "locations": report,
        },
        ignore="retrieved_at",
    )
    return {
        "version": version,
        "matched": [m.location_id for m in matches if m.station is not None],
        "unmatched": [m.location_id for m in matches if m.station is None],
        "series": len(written),
    }


def download(raw_dir: Path, *, http: httpx.Client) -> list[dict[str, Any]]:
    """下載壓縮檔與說明文件到 `raw_dir`，回傳並寫出 `downloads.json`（網址、大小、時間）。"""
    raw_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for name in [*ARCHIVES.values(), *DOCS]:
        url = BASE_URL + name
        target = raw_dir / name
        partial = target.with_suffix(target.suffix + ".part")
        with http.stream("GET", url) as response:
            if response.status_code >= 400:
                raise GhcnmError(f"{url} → HTTP {response.status_code}")
            with partial.open("wb") as handle:
                for chunk in response.iter_bytes():
                    handle.write(chunk)
            headers = response.headers
        partial.replace(target)
        records.append(
            {
                "url": url,
                "file": name,
                "size_bytes": target.stat().st_size,
                "last_modified": headers.get("last-modified"),
                "etag": headers.get("etag"),
                "retrieved_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
        )
    (raw_dir / "downloads.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return records


def _load_locations(seed_dir: Path) -> list[dict[str, Any]]:
    locations: list[dict[str, Any]] = []
    for name in ("locations.json", "locations.world.json"):
        locations.extend(json.loads((seed_dir / name).read_text(encoding="utf-8")))
    return locations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NOAA GHCNm v4 測站月均溫：下載與建置")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("download", "build"):
        sub = commands.add_parser(name)
        sub.add_argument("--raw-dir", type=Path, default=Path("data/raw/ghcnm"))
    build_parser = commands.choices["build"]
    build_parser.add_argument(
        "--out-dir", type=Path, default=Path("data/observed/ghcnm")
    )
    build_parser.add_argument("--seed-dir", type=Path, default=Path("data/seed"))
    args = parser.parse_args(argv)

    if args.command == "download":
        with httpx.Client(timeout=300, follow_redirects=True) as http:
            for record in download(args.raw_dir, http=http):
                print(
                    f"{record['file']}  {record['size_bytes']} bytes  {record['url']}"
                )
        return 0

    manifest = json.loads((args.raw_dir / "downloads.json").read_text(encoding="utf-8"))
    retrieved_at = max(
        r["retrieved_at"] for r in manifest if r["file"] in ARCHIVES.values()
    )
    summary = build(
        args.raw_dir,
        args.out_dir,
        _load_locations(args.seed_dir),
        retrieved_at=retrieved_at,
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
