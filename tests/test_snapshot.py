"""快照：從 Giovanni 回應到靜態檔的整條路，用錄下的 CSV、不連網。"""

import json
from datetime import date
from pathlib import Path

import httpx

from trend_detective.giovanni import GiovanniClient
from trend_detective.snapshot import build_snapshot

FIXTURE = Path(__file__).parent / "fixtures" / "giovanni_imerg_taichung_2020.csv"
SECRET = "secret-token-value"


def _client() -> GiovanniClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/quota":
            return httpx.Response(200, json={"status": 200, "quota": 0.0})
        return httpx.Response(200, text=FIXTURE.read_text(encoding="utf-8"))

    http = httpx.Client(
        transport=httpx.MockTransport(handler), base_url="https://giovanni.test/"
    )
    return GiovanniClient(token=SECRET, http=http)


def test_snapshot_writes_taichung_precipitation_series_matching_the_csv(
    tmp_path: Path,
):
    build_snapshot(
        _client(), tmp_path, today=date(2026, 11, 14), now="2026-11-14T08:00:00Z"
    )

    series = json.loads(
        (tmp_path / "series" / "imerg_precip__taichung__point.json").read_text()
    )
    assert series["unit"] == "mm/hr"  # 與 CSV 的 unit 行一致
    assert len(series["points"]) == 12  # 與 CSV 的資料列數一致
    assert all(p["month"].endswith("-01") for p in series["points"])
    assert series["points"][4] == {
        "month": "2020-05-01",
        "value": 0.495,
        "n_samples": 1,
        "coverage": 1,
    }
    assert series["grid"] == {"lat": 24.15, "lon": 120.649994}
    assert series["request"] == {
        "data": "GPM_3IMERGM_07_precipitation",
        "location": [24.15, 120.68],
        "start": "2001-01-01",
        "end_policy": "run_date",
    }


def test_snapshot_catalog_points_at_the_series_and_its_latest_month(tmp_path: Path):
    build_snapshot(
        _client(), tmp_path, today=date(2026, 11, 14), now="2026-11-14T08:00:00Z"
    )

    catalog = json.loads((tmp_path / "catalog.json").read_text())
    assert catalog["series"][0]["file"] == "series/imerg_precip__taichung__point.json"
    assert catalog["snapshot"]["latest_month"] == {"imerg_precip": "2020-12-01"}


def test_rerunning_on_a_later_day_changes_no_file_and_no_file_holds_the_token(
    tmp_path: Path,
):
    build_snapshot(
        _client(), tmp_path, today=date(2026, 11, 14), now="2026-11-14T08:00:00Z"
    )
    before = {p: p.read_bytes() for p in tmp_path.rglob("*.json")}

    build_snapshot(
        _client(), tmp_path, today=date(2026, 11, 15), now="2026-11-15T09:00:00Z"
    )

    assert {p: p.read_bytes() for p in tmp_path.rglob("*.json")} == before
    assert all(SECRET.encode() not in content for content in before.values())
