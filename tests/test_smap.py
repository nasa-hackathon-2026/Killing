"""SMAP L3 的取得與轉換：EASE-Grid 2.0 像元對位、品質過濾、日轉月。不連網。"""

import json
from datetime import date
from pathlib import Path

import netCDF4
import numpy as np
import pytest

from trend_detective import smap

FIXTURES = Path(__file__).parent / "fixtures" / "smap"
FILL = -9999.0
FLAG_FILL = 65534


# --- EASE-Grid 2.0 36 km 的像元位置 -------------------------------------------------


def test_cell_center_matches_granule_latitude_longitude():
    # 2026-11-13 的 granule 在這兩格的 latitude／longitude（2026-11-15 實測）
    lat, lon = smap.cell_center(114, 804)
    assert lat == pytest.approx(25.84, abs=0.01)
    assert lon == pytest.approx(120.44, abs=0.01)
    lat, lon = smap.cell_center(125, 811 - 1)
    assert lat == pytest.approx(22.44, abs=0.01)
    assert lon == pytest.approx(122.68, abs=0.01)


def test_cell_of_inverts_cell_center():
    for row, col in [(0, 0), (114, 804), (405, 963), (200, 500)]:
        assert smap.cell_of(*smap.cell_center(row, col)) == (row, col)


def test_cell_of_taiwan_points():
    # 臺中 24.15°N 120.68°E 落在中心 24.29°N 的列與 120.81°E 的行附近
    row, col = smap.cell_of(24.15, 120.68)
    lat, lon = smap.cell_center(row, col)
    assert abs(lat - 24.15) < 0.2
    assert abs(lon - 120.68) < 0.2


def test_cell_of_rejects_outside_grid():
    with pytest.raises(ValueError):
        smap.cell_of(89.0, 10.0)


def test_window_covers_points_and_boxes_with_margin():
    locations = [
        {"id": "p", "kind": "point", "lat": 24.15, "lon": 120.68},
        {"id": "r", "kind": "region", "bbox": [120.0, 21.8, 122.1, 25.4]},
    ]
    window = smap.window_for(locations, margin=1)
    for lat, lon in [(24.15, 120.68), (21.8, 120.0), (25.4, 122.1)]:
        row, col = smap.cell_of(lat, lon)
        assert window.row0 < row < window.row1
        assert window.col0 < col < window.col1


def test_constraint_lists_both_passes_with_slices():
    window = smap.Window(row0=112, row1=130, col0=798, col1=811)
    text = smap.constraint(window)
    assert text.count(";") == 5
    assert "/Soil_Moisture_Retrieval_Data_AM/soil_moisture[112:130][798:811]" in text
    assert (
        "/Soil_Moisture_Retrieval_Data_PM/retrieval_qual_flag_pm[112:130][798:811]"
        in text
    )


# --- CMR ---------------------------------------------------------------------------


def test_parse_granules_keeps_opendap_link_by_day():
    page = json.loads((FIXTURES / "cmr_page.json").read_text(encoding="utf-8"))
    found = smap.parse_granules(page["items"])
    assert found == {
        date(2026, 11, 12): "https://opendap.example/granules/A.h5_x",
        date(2026, 11, 13): "https://opendap.example/granules/B.h5_y",
    }


def _granule(ur: str, url: str, day: str = "2026-11-13") -> dict:
    return {
        "umm": {
            "GranuleUR": ur,
            "TemporalExtent": {
                "RangeDateTime": {"BeginningDateTime": f"{day}T00:00:00Z"}
            },
            "RelatedUrls": [{"Subtype": "OPENDAP DATA", "URL": url}],
        }
    }


def test_parse_granules_takes_latest_production_when_a_day_is_reprocessed():
    items = [
        _granule("SMAP_L3_SM_P_20261013_R19240_002.h5", "second"),
        _granule("SMAP_L3_SM_P_20261013_R19240_001.h5", "first"),
    ]
    assert smap.parse_granules(items) == {date(2026, 11, 13): "second"}


def test_parse_granules_rejects_identical_granule_ur_twice():
    item = _granule("same", "u")
    with pytest.raises(smap.SmapError, match="2026-11-13"):
        smap.parse_granules([item, item])


# --- 一天的有效值 -------------------------------------------------------------------


def _grid(values):
    return np.array(values, dtype=np.float32)


def _flags(values):
    return np.array(values, dtype=np.uint16)


def test_valid_values_keep_only_recommended_quality():
    sm = _grid([[0.20, 0.21, 0.22, 0.23, 0.24, FILL]])
    # 0 與 8 是官方建議的品質；1（非建議）、2（沒試）、65534（無資料）都不用
    flag = _flags([[0, 8, 1, 2, FLAG_FILL, FLAG_FILL]])
    out = smap.valid_values(sm, flag)
    assert out[0, 0] == pytest.approx(0.20)
    assert out[0, 1] == pytest.approx(0.21)
    assert np.isnan(out[0, 2:]).all()


def test_valid_values_drop_outside_declared_range():
    sm = _grid([[0.01, 0.02, 0.5, 0.51]])
    flag = _flags([[0, 0, 0, 0]])
    out = smap.valid_values(sm, flag)
    assert np.isnan(out[0, 0]) and np.isnan(out[0, 3])
    assert out[0, 1] == pytest.approx(0.02)
    assert out[0, 2] == pytest.approx(0.5)


def test_daily_values_average_the_valid_passes():
    am = np.array([[0.20, 0.30, np.nan, np.nan]])
    pm = np.array([[0.30, np.nan, 0.40, np.nan]])
    out = smap.daily_values(am, pm)
    assert out[0, 0] == pytest.approx(0.25)
    assert out[0, 1] == pytest.approx(0.30)
    assert out[0, 2] == pytest.approx(0.40)
    assert np.isnan(out[0, 3])


# --- 讀 OPeNDAP 回傳的小檔 -----------------------------------------------------------


def _write_day(path: Path, *, am, am_flag, pm, pm_flag, surface):
    with netCDF4.Dataset(path, "w") as ds:
        for name, suffix, sm, flag in [
            ("Soil_Moisture_Retrieval_Data_AM", "", am, am_flag),
            ("Soil_Moisture_Retrieval_Data_PM", "_pm", pm, pm_flag),
        ]:
            group = ds.createGroup(name)
            group.createDimension("y", sm.shape[0])
            group.createDimension("x", sm.shape[1])
            v = group.createVariable(
                f"soil_moisture{suffix}", "f4", ("y", "x"), fill_value=FILL
            )
            v[:] = sm
            v = group.createVariable(
                f"retrieval_qual_flag{suffix}", "u2", ("y", "x"), fill_value=FLAG_FILL
            )
            v[:] = flag
            v = group.createVariable(
                f"surface_flag{suffix}", "u2", ("y", "x"), fill_value=FLAG_FILL
            )
            v[:] = surface


def test_read_day_returns_valid_daily_values_and_surface_flags(tmp_path):
    path = tmp_path / "20260113.nc4"
    _write_day(
        path,
        am=np.ma.masked_values(_grid([[0.20, FILL], [0.30, 0.10]]), FILL),
        am_flag=_flags([[0, FLAG_FILL], [1, 8]]),
        pm=np.ma.masked_values(_grid([[0.30, FILL], [0.40, FILL]]), FILL),
        pm_flag=_flags([[0, FLAG_FILL], [0, FLAG_FILL]]),
        surface=_flags([[0, FLAG_FILL], [512, 1024]]),
    )
    day = smap.read_day(path)
    assert day.values[0, 0] == pytest.approx(0.25)
    assert np.isnan(day.values[0, 1])
    # AM 的品質旗標是 1 所以不用，只剩 PM 的 0.40
    assert day.values[1, 0] == pytest.approx(0.40)
    assert day.values[1, 1] == pytest.approx(0.10)
    assert day.surface_am[1, 0] == 512
    assert day.surface_am[0, 1] == FLAG_FILL


def test_read_day_rejects_missing_group(tmp_path):
    path = tmp_path / "bad.nc4"
    with netCDF4.Dataset(path, "w") as ds:
        ds.createGroup("Other")
    with pytest.raises(smap.SmapError):
        smap.read_day(path)


# --- 日轉月 -------------------------------------------------------------------------


def _days(*items):
    return {day: np.array(values, dtype=float) for day, values in items}


def test_monthly_cell_means_count_valid_days():
    nan = np.nan
    days = _days(
        (date(2020, 1, 1), [[0.2, nan]]),
        (date(2020, 1, 2), [[0.4, nan]]),
        (date(2020, 2, 1), [[nan, nan]]),
    )
    months = smap.monthly_cells(days)
    jan = months[date(2020, 1, 1)]
    assert jan.mean[0, 0] == pytest.approx(0.3)
    assert np.isnan(jan.mean[0, 1])
    assert jan.count[0].tolist() == [2, 0]
    assert jan.days_with_data == 2
    assert months[date(2020, 2, 1)].count.sum() == 0


def test_point_points_value_n_samples_and_coverage():
    nan = np.nan
    days = _days(
        (date(2020, 1, 1), [[0.2, nan]]),
        (date(2020, 1, 2), [[0.4, nan]]),
        (date(2020, 2, 1), [[nan, nan]]),
    )
    points = smap.point_points(smap.monthly_cells(days), row=0, col=0)
    assert points[0] == {
        "month": "2020-01-01",
        "value": pytest.approx(0.3),
        "n_samples": 2,
        "coverage": pytest.approx(2 / 31),
    }
    assert points[1] == {
        "month": "2020-02-01",
        "value": None,
        "n_samples": 0,
        "coverage": 0,
    }


def test_region_points_average_cells_that_have_data():
    nan = np.nan
    days = _days(
        (date(2020, 1, 1), [[0.2, 0.4, nan]]),
        (date(2020, 1, 2), [[nan, 0.6, nan]]),
        (date(2020, 1, 3), [[nan, nan, nan]]),
    )
    mask = np.array([[True, True, False]])
    points = smap.region_points(smap.monthly_cells(days), mask)
    # 格 0：0.2（1 天）；格 1：(0.4 + 0.6) / 2 = 0.5；區域是兩格的平均
    assert points[0]["value"] == pytest.approx(0.35)
    # 有任何一格有值的天數是 2（1 號、2 號），不是格子的天數總和
    assert points[0]["n_samples"] == 2
    assert points[0]["coverage"] == pytest.approx(2 / 31)


def test_region_mask_uses_cell_centers_inside_bbox():
    window = smap.Window(row0=112, row1=130, col0=798, col1=811)
    mask = smap.region_mask(window, [120.0, 21.8, 122.1, 25.4])
    assert mask.shape == (19, 14)
    rows, cols = np.nonzero(mask)
    assert rows.size > 20
    lat, lon = smap.cell_center(window.row0 + rows[0], window.col0 + cols[0])
    assert 21.8 <= lat <= 25.4 and 120.0 <= lon <= 122.1
    # 不在 bbox 內的格子中心不收
    outside = ~mask
    lat, lon = smap.cell_center(window.row0, window.col0)
    assert outside[0, 0]
    assert not (21.8 <= lat <= 25.4 and 120.0 <= lon <= 122.1)


def test_months_between_fills_missing_months_with_empty_points():
    days = _days((date(2020, 1, 5), [[0.2]]), (date(2020, 3, 5), [[0.3]]))
    points = smap.point_points(smap.monthly_cells(days), row=0, col=0)
    assert [p["month"] for p in points] == ["2020-01-01", "2020-02-01", "2020-03-01"]
    assert points[1]["value"] is None and points[1]["n_samples"] == 0


# --- 組裝：日檔 → 序列檔、目錄檔、報告 -------------------------------------------------


def test_build_writes_series_catalog_and_report(tmp_path):
    locations = [
        {"id": "pt", "kind": "point", "lat": 24.15, "lon": 120.68},
        {"id": "nodata", "kind": "point", "lat": 22.63, "lon": 120.3},
        {"id": "box", "kind": "region", "bbox": [120.0, 23.5, 121.3, 24.6]},
    ]
    locations_file = tmp_path / "locations.json"
    locations_file.write_text(json.dumps(locations), encoding="utf-8")
    seed_file = tmp_path / "smap.json"
    seed_file.write_text(
        json.dumps(
            {
                "locations": ["pt", "nodata", "box"],
                "variables": [{"id": smap.VARIABLE_ID, "name_en": "Soil moisture"}],
            }
        ),
        encoding="utf-8",
    )
    window = smap.window_for(smap.load_locations(locations_file))
    shape = window.shape
    pt = smap.cell_of(24.15, 120.68)
    raw = tmp_path / "raw"
    raw.mkdir()
    for day, value in [
        (date(2020, 1, 1), 0.2),
        (date(2020, 1, 2), 0.4),
        (date(2020, 2, 3), 0.3),
    ]:
        sm = np.full(shape, FILL, dtype=np.float32)
        flag = np.full(shape, FLAG_FILL, dtype=np.uint16)
        sm[pt[0] - window.row0, pt[1] - window.col0] = value
        flag[pt[0] - window.row0, pt[1] - window.col0] = 0
        _write_day(
            raw / f"{day:%Y%m%d}.nc4",
            am=np.ma.masked_values(sm, FILL),
            am_flag=flag,
            pm=np.ma.masked_values(np.full(shape, FILL, dtype=np.float32), FILL),
            pm_flag=np.full(shape, FLAG_FILL, dtype=np.uint16),
            surface=np.full(shape, 512, dtype=np.uint16),
        )
    out = tmp_path / "out"
    report = smap.build(raw, out, seed_file=seed_file, locations_file=locations_file)

    series = json.loads((out / "series" / "smap_sm_l3__pt__point.json").read_text())
    assert series["unit"] == "m3 m-3"
    assert series["source_api"] == "smap"
    assert [p["n_samples"] for p in series["points"]] == [2, 1]
    assert series["points"][0]["value"] == pytest.approx(0.3, abs=1e-6)
    assert not (out / "series" / "smap_sm_l3__nodata__point.json").exists()
    assert report["skipped"] == [{"location_id": "nodata", "reason": "no valid month"}]
    catalog = json.loads((out / "catalog.json").read_text())
    # box 的範圍包含 pt 那一格，所以區域也有序列；nodata 沒有
    assert [e["location_id"] for e in catalog["series"]] == ["box", "pt"]
    box = json.loads(
        (out / "series" / "smap_sm_l3__box__area_mean_cells.json").read_text()
    )
    assert box["points"][0]["value"] == pytest.approx(0.3, abs=1e-6)
    assert box["request"]["n_cells_in_bbox"] > 1
    assert catalog["variables"][0]["unit"] == "m3 m-3"
    assert catalog["variables"][0]["valid_from"] == "2020-01-01"
    assert report["n_day_files"] == 3


def test_quality_diagnostics_separate_retrieved_from_recommended(tmp_path):
    path = tmp_path / "20260113.nc4"
    _write_day(
        path,
        am=np.ma.masked_values(_grid([[0.20, 0.30, FILL]]), FILL),
        am_flag=_flags([[0, 9, 15]]),
        pm=np.ma.masked_values(_grid([[0.25, FILL, FILL]]), FILL),
        pm_flag=_flags([[9, FLAG_FILL, FLAG_FILL]]),
        surface=_flags([[0, 512 + 1024, 7]]),
    )
    day = smap.read_day(path)
    out = smap.quality_diagnostics([day], [(0, 0), (0, 1), (0, 2)])
    # AM 三格都有資料、PM 只有第一格；有反演值的是 AM 第 0、1 格與 PM 第 0 格
    assert out["passes_with_data"] == 4
    assert out["passes_retrieved"] == 3
    assert out["passes_recommended"] == 1
    assert out["retrieved_by_quality_flag"] == {"0": 1, "9": 2}
    fractions = out["retrieved_surface_flag_fractions"]
    assert fractions["mountainous_terrain"] == pytest.approx(1 / 3)
    assert fractions["dense_vegetation"] == pytest.approx(1 / 3)
