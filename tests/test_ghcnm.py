"""NOAA GHCNm v4：固定欄寬解析、品質旗標、配站、月序列與整條建置流程（不連網）。

fixture 是 2026-11-14 取得的 ghcnm.tavg.v4.0.1.20261113 檔案節錄（`tests/fixtures/ghcnm/`）。
"""

import io
import json
import tarfile
from datetime import date
from pathlib import Path

import pytest

from trend_detective import ghcnm

FIXTURES = Path(__file__).parent / "fixtures" / "ghcnm"
INV = (FIXTURES / "sample.inv").read_text(encoding="utf-8")
QCF = (FIXTURES / "sample.qcf.dat").read_text(encoding="utf-8").splitlines()
QCU = (FIXTURES / "sample.qcu.dat").read_text(encoding="utf-8").splitlines()


def test_inventory_is_read_by_column_position():
    stations = {s.id: s for s in ghcnm.parse_inventory(INV)}

    taipei = stations["TWM00058968"]
    assert (taipei.lat, taipei.lon, taipei.elevation_m) == (25.033, 121.517, 9.0)
    assert taipei.name == "TAIBEI"
    # 站名裡有空白與標點時整段保留；經度為負的欄位也要讀得對
    assert stations["CH000052707"].name == "T'A_ERH_TING"
    assert stations["ACW00011604"].lon == 11.8667


def test_missing_elevation_is_none():
    line = "XX000000001  10.0000   20.0000 -999.0 NOWHERE                       "

    (station,) = ghcnm.parse_inventory(line)

    assert station.elevation_m is None


def test_data_line_gives_twelve_readings_with_flags():
    station_id, year, readings = ghcnm.parse_data_line(QCU[3])  # CH000052707 1974 QCU

    assert (station_id, year, len(readings)) == ("CH000052707", 1974, 12)
    assert readings[0].value == pytest.approx(-12.12)
    assert readings[3].value is None  # -9999
    assert (readings[7].qc_flag, readings[7].ds_flag) == ("S", "]")
    assert readings[7].value == pytest.approx(21.94)
    assert readings[0].qc_flag == " "


def test_data_line_rejects_other_elements_and_wrong_widths():
    with pytest.raises(ValueError, match="TAVG"):
        ghcnm.parse_data_line(QCF[0].replace("TAVG", "TMAX"))
    with pytest.raises(ValueError, match="115"):
        ghcnm.parse_data_line(QCF[0][:-1])


def test_qc_flagged_value_is_not_usable_but_alternative_adjustment_is():
    flagged = ghcnm.Reading(21.94, " ", "S", "]")
    adjusted = ghcnm.Reading(10.0, " ", "A", "]")
    missing = ghcnm.Reading(None, " ", "X", "]")

    assert ghcnm.usable_value(flagged) is None
    assert ghcnm.usable_value(adjusted) == 10.0
    assert ghcnm.usable_value(missing) is None
    assert ghcnm.usable_value(ghcnm.Reading(1.5, " ", " ", "]")) == 1.5


def test_read_records_keeps_only_wanted_stations_and_sorts_months():
    records = ghcnm.read_records(QCF, {"TWM00058968", "CH000052707"})

    assert set(records) == {"TWM00058968", "CH000052707"}
    taipei = records["TWM00058968"]
    assert min(taipei) == date(2001, 1, 1) and max(taipei) == date(2002, 12, 1)
    assert len(taipei) == 24
    assert taipei[date(2001, 4, 1)].value is None


def test_read_records_rejects_the_same_month_twice():
    with pytest.raises(ValueError, match="2001"):
        ghcnm.read_records([QCF[0], QCF[0]], {"TWM00058968"})


def test_usable_values_drop_qc_flagged_months_in_qcu():
    qcu = ghcnm.read_records(QCU, {"CH000052707"})["CH000052707"]

    values = ghcnm.usable_values(qcu)

    assert date(1974, 8, 1) not in values  # 旗標 S
    assert date(1974, 9, 1) not in values  # 旗標 O
    assert values[date(1974, 1, 1)] == pytest.approx(-12.12)
    assert len(values) == 6 + 12  # 1974 剩 6 個月，1975 全部 12 個月有值


def test_usable_values_count_for_the_fixture_months():
    qcu = ghcnm.read_records(QCU, {"CH000052707"})["CH000052707"]
    qcf = ghcnm.read_records(QCF, {"CH000052707"})["CH000052707"]

    # 1974：QCU 缺值 2 個月、旗標 S O O S 共 4 個月，剩 6 個月
    assert len(ghcnm.usable_values(qcu, year=1974)) == 12 - 2 - 4
    assert len(ghcnm.usable_values(qcf, year=1974)) == 0
    assert len(ghcnm.usable_values(qcf, year=1975)) == 10


def test_flag_counts_cover_missing_months_too():
    qcf = ghcnm.read_records(QCF, {"CH000052707"})["CH000052707"]
    qcu = ghcnm.read_records(QCU, {"CH000052707"})["CH000052707"]

    assert ghcnm.qc_flag_counts(qcf) == {"Q": 4, "X": 8}
    assert ghcnm.qc_flag_counts(qcu) == {"O": 2, "S": 2}


def test_distance_matches_the_known_taipei_taichung_gap():
    km = ghcnm.distance_km(25.03, 121.56, 24.15, 120.68)

    assert km == pytest.approx(131.0, abs=1.5)
    assert ghcnm.distance_km(10, 20, 10, 20) == 0


def test_months_in_window_counts_inclusively():
    values = {
        date(2000, 12, 1): 1.0,
        date(2001, 1, 1): 1.0,
        date(2025, 12, 1): 1.0,
        date(2026, 1, 1): 1.0,
    }

    assert ghcnm.months_in_window(values, date(2001, 1, 1), date(2025, 12, 1)) == 2


def _station(station_id: str, lat: float, lon: float, elevation: float | None = 10.0):
    return ghcnm.Station(station_id, lat, lon, elevation, station_id)


def test_nearest_station_with_enough_months_wins_over_a_nearer_thin_one():
    near, far, too_far = (
        _station("NEAR", 25.0, 121.5, 5.0),
        _station("FAR", 25.3, 121.5, 55.0),
        _station("TOOFAR", 30.0, 121.5),
    )
    counts = {"NEAR": 100, "FAR": 300, "TOOFAR": 300}
    location = {"id": "p", "lat": 25.03, "lon": 121.56, "elevation_m": 20.0}

    result = ghcnm.match_location(
        location, [near, far, too_far], counts, max_km=100, min_months=240
    )

    assert result.station is not None and result.station.id == "FAR"
    assert result.reason is None
    assert result.elevation_diff_m == 35.0
    assert result.distance_km == pytest.approx(30.4, abs=0.5)
    assert [c.station.id for c in result.candidates] == ["NEAR", "FAR"]


def test_match_without_location_elevation_has_no_elevation_difference():
    result = ghcnm.match_location(
        {"id": "p", "lat": 25.0, "lon": 121.5},
        [_station("A", 25.0, 121.5)],
        {"A": 300},
        max_km=100,
        min_months=240,
    )

    assert result.station is not None
    assert result.elevation_diff_m is None


def test_no_match_says_why():
    location = {"id": "p", "lat": 25.0, "lon": 121.5}
    thin = ghcnm.match_location(
        location, [_station("A", 25.0, 121.5)], {"A": 10}, max_km=100, min_months=240
    )
    empty = ghcnm.match_location(
        location, [_station("B", 40.0, 10.0)], {}, max_km=100, min_months=240
    )

    assert thin.station is None and thin.reason == "no_station_with_enough_months"
    assert empty.station is None and empty.reason == "no_station_within_distance"
    assert empty.nearest_any is not None and empty.nearest_any[0].id == "B"


def test_points_have_only_months_with_values_and_unit_coverage():
    points = ghcnm.monthly_points({date(2001, 3, 1): 19.53, date(2001, 1, 1): 17.81})

    assert points == [
        {"month": "2001-01-01", "value": 17.81, "n_samples": 1, "coverage": 1.0},
        {"month": "2001-03-01", "value": 19.53, "n_samples": 1, "coverage": 1.0},
    ]


def test_version_comes_from_the_archive_member_name():
    name = "ghcnm.v4.0.1.20261113/ghcnm.tavg.v4.0.1.20261113.qcf.dat"

    assert ghcnm.version_from_member(name) == "v4.0.1.20261113"
    with pytest.raises(ValueError):
        ghcnm.version_from_member("something/else.dat")


def _archive(path: Path, kind: str, dat_lines: list[str]) -> None:
    prefix = "ghcnm.v4.0.1.20261113"
    stem = f"ghcnm.tavg.v4.0.1.20261113.{kind}"
    with tarfile.open(path, "w:gz") as tar:
        for suffix, text in (("inv", INV), ("dat", "\n".join(dat_lines) + "\n")):
            data = text.encode("utf-8")
            info = tarfile.TarInfo(f"{prefix}/{stem}.{suffix}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))


def test_build_writes_series_catalog_and_station_report(tmp_path: Path):
    raw = tmp_path / "raw"
    raw.mkdir()
    _archive(raw / "ghcnm.tavg.latest.qcf.tar.gz", "qcf", QCF)
    _archive(raw / "ghcnm.tavg.latest.qcu.tar.gz", "qcu", QCU)
    out = tmp_path / "observed"
    locations = [
        {"id": "taipei", "kind": "point", "lat": 25.03, "lon": 121.56},
        {"id": "nowhere", "kind": "point", "lat": -40.0, "lon": 0.0},
        {"id": "taiwan", "kind": "region", "bbox": [119, 21, 123, 26]},
    ]

    # 夾具只有 2001–2002 兩年（17 個月有值），所以把門檻降到 15 個月以測流程
    summary = ghcnm.build(
        raw,
        out,
        locations,
        retrieved_at="2026-11-15T00:00:00Z",
        min_months=15,
        window=(date(2001, 1, 1), date(2002, 12, 1)),
    )

    assert summary["matched"] == ["taipei"] and summary["unmatched"] == ["nowhere"]
    qcf = json.loads((out / "series/ghcnm_tavg__taipei__point.json").read_text())
    qcu = json.loads((out / "series/ghcnm_tavg_unadj__taipei__point.json").read_text())
    assert qcf["aggregation"] == "point" and qcf["unit"] == "degC"
    assert qcf["source_api"] == "noaa_ghcnm"
    assert qcf["product_version"] == "GHCNm v4.0.1.20261113 QCF"
    assert qcu["product_version"] == "GHCNm v4.0.1.20261113 QCU"
    assert qcf["request"]["station_id"] == "TWM00058968"
    assert qcf["request"]["distance_km"] == pytest.approx(4.35, abs=0.15)
    assert "elevation_diff_m" not in qcf["request"]
    assert qcf["points"][0] == {
        "month": "2001-01-01",
        "value": 17.81,
        "n_samples": 1,
        "coverage": 1.0,
    }
    assert len(qcf["points"]) == 17 and len(qcu["points"]) == 17

    catalog = json.loads((out / "catalog.json").read_text())
    assert {
        (s["variable_id"], s["location_id"], s["aggregation"])
        for s in catalog["series"]
    } == {
        ("ghcnm_tavg", "taipei", "point"),
        ("ghcnm_tavg_unadj", "taipei", "point"),
    }

    stations = json.loads((out / "stations.json").read_text())
    by_location = {row["location_id"]: row for row in stations["locations"]}
    assert by_location["taipei"]["station"]["id"] == "TWM00058968"
    assert by_location["nowhere"]["station"] is None
    assert by_location["nowhere"]["reason"] == "no_station_within_distance"
    assert "taiwan" not in by_location
    assert stations["product_version"] == "v4.0.1.20261113"


def test_rebuild_with_the_same_data_leaves_files_untouched(tmp_path: Path):
    raw = tmp_path / "raw"
    raw.mkdir()
    _archive(raw / "ghcnm.tavg.latest.qcf.tar.gz", "qcf", QCF)
    _archive(raw / "ghcnm.tavg.latest.qcu.tar.gz", "qcu", QCU)
    out = tmp_path / "observed"
    locations = [{"id": "taipei", "kind": "point", "lat": 25.03, "lon": 121.56}]
    kwargs = {
        "min_months": 15,
        "window": (date(2001, 1, 1), date(2002, 12, 1)),
    }
    ghcnm.build(raw, out, locations, retrieved_at="2026-11-15T00:00:00Z", **kwargs)
    path = out / "series/ghcnm_tavg__taipei__point.json"
    before = path.stat().st_mtime_ns

    ghcnm.build(raw, out, locations, retrieved_at="2026-11-16T00:00:00Z", **kwargs)

    assert path.stat().st_mtime_ns == before
    assert json.loads(path.read_text())["retrieved_at"] == "2026-11-15T00:00:00Z"
