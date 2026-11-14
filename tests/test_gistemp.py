"""NASA GISTEMP v4：2°×2° 格點檔與全球／半球 CSV 的解析、格子對應與序列輸出。"""

import json
from datetime import date
from pathlib import Path

import netCDF4
import numpy as np
import pytest

from trend_detective.gistemp import (
    HEMISPHERES,
    GistempError,
    GridProduct,
    build_grid_series,
    build_table_series,
    cell_index,
    file_created,
    parse_table_csv,
    read_grid,
)

FIXTURES = Path(__file__).parent / "fixtures" / "gistemp"
FILL = 32767

PRODUCT = GridProduct(
    variable_id="gistemp_anom",
    file="gistemp1200_GHCNv4_ERSSTv5.nc.gz",
    url="https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz",
    smoothing_km=1200,
    land_only=False,
)


def write_nc(path: Path, *, anomaly: list[list[list[int]]], history: str) -> None:
    """3 個月 × 2 緯度 × 2 經度的小格點檔；欄位與官方檔相同（int16、scale_factor 0.01）。"""
    with netCDF4.Dataset(path, "w") as nc:
        nc.history = history
        nc.createDimension("time", 3)
        nc.createDimension("lat", 2)
        nc.createDimension("lon", 2)
        nc.createDimension("nv", 2)
        lat = nc.createVariable("lat", "f4", ("lat",))
        lat[:] = [23.0, 25.0]
        lon = nc.createVariable("lon", "f4", ("lon",))
        lon[:] = [119.0, 121.0]
        time = nc.createVariable("time", "i4", ("time",))
        time.units = "days since 1800-01-01 00:00:00"
        # 1880-01-15、1880-02-15、1880-03-15
        time[:] = [29233, 29264, 29293]
        bounds = nc.createVariable("time_bnds", "i4", ("time", "nv"))
        bounds[:] = [[29219, 29250], [29250, 29279], [29279, 29310]]
        temp = nc.createVariable(
            "tempanomaly", "i2", ("time", "lat", "lon"), fill_value=FILL
        )
        temp.scale_factor = np.float32(0.01)
        temp.units = "K"
        temp.set_auto_maskandscale(False)
        temp[:] = np.array(anomaly, dtype="i2")


HISTORY = "Created 2026-11-10 08:55:39 by SBBX_to_nc 2.0 - ILAND=1200, IOCEAN=NCDC/ER5, Base: 1951-1980"
# [月][緯度 23, 25][經度 119, 121]
ANOMALY = [
    [[10, FILL], [-48, 125]],
    [[11, FILL], [-52, 130]],
    [[FILL, FILL], [FILL, 140]],
]


@pytest.fixture
def nc_path(tmp_path: Path) -> Path:
    path = tmp_path / "tiny.nc"
    write_nc(path, anomaly=ANOMALY, history=HISTORY)
    return path


def test_cell_index_uses_the_2_degree_cell_that_contains_the_point():
    lats = np.array([23.0, 25.0])
    lons = np.array([119.0, 121.0])
    # 台北 (25.03, 121.56) 在 24–26°N、120–122°E 的格子，中心 (25, 121)
    assert cell_index(25.03, 121.56, lats, lons) == (1, 1)
    # 花蓮 23.99 < 24，落在 22–24°N 的格子
    assert cell_index(23.99, 121.6, lats, lons) == (0, 1)
    assert cell_index(22.63, 120.3, lats, lons) == (0, 1)


def test_cell_index_rejects_a_point_outside_the_grid():
    lats = np.array([23.0, 25.0])
    lons = np.array([119.0, 121.0])
    with pytest.raises(GistempError, match="不在格點範圍"):
        cell_index(40.0, 121.0, lats, lons)


def test_cell_index_wraps_longitudes_past_180():
    lats = np.array([-1.0, 1.0])
    lons = np.array([-179.0, 179.0])
    assert cell_index(0.5, 181.0, lats, lons) == (1, 0)


def test_read_grid_decodes_scale_months_and_fill_values(nc_path: Path):
    grid = read_grid(nc_path)

    assert grid.months == [date(1880, 1, 1), date(1880, 2, 1), date(1880, 3, 1)]
    assert grid.created == date(2026, 11, 10)
    assert grid.baseline == "1951-1980"
    assert grid.unit == "K"
    assert grid.values.shape == (3, 2, 2)
    # 25°N、121°E：1.25、1.30、1.40；整數除以 100，不帶 float32 的尾數
    assert [float(v) for v in grid.values[:, 1, 1]] == [1.25, 1.3, 1.4]
    assert [float(v) for v in grid.values[:2, 1, 0]] == [-0.48, -0.52]
    assert bool(np.ma.getmaskarray(grid.values)[0, 0, 1])


def test_read_grid_rejects_an_unexpected_scale_factor(tmp_path: Path):
    path = tmp_path / "bad.nc"
    write_nc(path, anomaly=ANOMALY, history=HISTORY)
    with netCDF4.Dataset(path, "a") as nc:
        nc["tempanomaly"].scale_factor = np.float32(0.1)

    with pytest.raises(GistempError, match="scale_factor"):
        read_grid(path)


def test_file_created_reads_the_date_from_the_history_attribute():
    assert file_created(HISTORY) == date(2026, 11, 10)
    with pytest.raises(GistempError, match="Created"):
        file_created("no date here")


def test_grid_series_for_a_point_records_the_cell_and_the_product(nc_path: Path):
    grid = read_grid(nc_path)

    series = build_grid_series(
        grid,
        PRODUCT,
        location_id="taipei",
        lat=25.03,
        lon=121.56,
        retrieved_at="2026-11-14T21:39:19Z",
    )

    assert series is not None
    assert series.file == "series/gistemp_anom__taipei__point.json"
    assert series.unit == "K"
    assert series.source_api == "gistemp"
    assert series.grid == {"lat": 25.0, "lon": 121.0}
    assert [p["value"] for p in series.points] == [1.25, 1.3, 1.4]
    assert series.points[0] == {
        "month": "1880-01-01",
        "value": 1.25,
        "n_samples": 1,
        "coverage": 1,
    }
    assert series.request["location"] == [25.03, 121.56]
    assert series.request["cell_center"] == [25.0, 121.0]
    assert series.request["cell_size_deg"] == 2
    assert series.request["baseline"] == "1951-1980"
    assert series.request["smoothing_radius_km"] == 1200
    assert series.request["land_only"] is False
    assert series.request["file"] == "gistemp1200_GHCNv4_ERSSTv5.nc.gz"
    assert series.request["file_created"] == "2026-11-10"
    assert "不是該點實測" in series.request["note"]
    # 序列檔裡不得有 token 之類的東西；整份可以轉成 JSON
    json.dumps(series.request)


def test_grid_series_keeps_inner_gaps_and_drops_leading_and_trailing_missing(
    nc_path: Path,
):
    grid = read_grid(nc_path)

    series = build_grid_series(
        grid,
        PRODUCT,
        location_id="x",
        lat=23.5,
        lon=121.5,
        retrieved_at="2026-11-14T21:39:19Z",
    )
    # 格子 (23, 121)：全是缺值，沒有任何月份可存
    assert series is None

    # 格子 (23, 119) 在第 3 個月缺值：結尾缺月不存
    series = build_grid_series(
        grid,
        PRODUCT,
        location_id="y",
        lat=22.5,
        lon=118.5,
        retrieved_at="2026-11-14T21:39:19Z",
    )
    assert series is not None
    assert [p["month"] for p in series.points] == ["1880-01-01", "1880-02-01"]


def test_grid_series_marks_an_inner_gap_as_a_missing_month(tmp_path: Path):
    path = tmp_path / "gap.nc"
    write_nc(
        path,
        anomaly=[
            [[10, FILL], [FILL, 125]],
            [[FILL, FILL], [FILL, 130]],
            [[12, FILL], [FILL, 140]],
        ],
        history=HISTORY,
    )

    series = build_grid_series(
        read_grid(path),
        PRODUCT,
        location_id="y",
        lat=22.5,
        lon=118.5,
        retrieved_at="2026-11-14T21:39:19Z",
    )

    assert series is not None
    assert series.points[1] == {
        "month": "1880-02-01",
        "value": None,
        "n_samples": 0,
        "coverage": 0,
    }


def test_parse_table_reads_monthly_cells_and_ignores_seasonal_columns():
    rows = parse_table_csv((FIXTURES / "GLB_sample.csv").read_text(encoding="utf-8"))

    assert rows[0] == (date(1880, 1, 1), -0.19)
    assert rows[11] == (date(1880, 12, 1), -0.18)
    assert rows[12] == (date(1881, 1, 1), -0.20)
    # 後面幾年也在；一年 12 個月，沒有年平均或季平均混進來
    assert len(rows) == 12 * 5
    assert rows[-12] == (date(2026, 1, 1), 1.08)
    assert rows[-3] == (date(2026, 10, 1), 1.55)
    # *** 是尚未發布的月份
    assert rows[-2] == (date(2026, 11, 1), None)
    assert rows[-1] == (date(2026, 12, 1), None)


def test_parse_table_skips_repeated_header_lines():
    text = (
        "Land-Ocean: Global Means\n"
        "Year,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,J-D,D-N,DJF,MAM,JJA,SON\n"
        "1880,-.19,-.25,-.10,-.17,-.10,-.21,-.19,-.11,-.15,-.23,-.22,-.18,-.18,***,***,-.12,-.17,-.20\n"
        "Year,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,J-D,D-N,DJF,MAM,JJA,SON\n"
        "1881,-.20,-.15,.03,.05,.06,-.19,.00,-.03,-.15,-.22,-.19,-.07,-.09,-.10,-.18,.04,-.08,-.19\n"
    )

    assert len(parse_table_csv(text)) == 24


def test_parse_table_rejects_a_file_without_the_expected_header():
    with pytest.raises(GistempError, match="Jan"):
        parse_table_csv("a,b,c\n1,2,3\n")


def test_parse_table_rejects_a_value_that_is_not_a_number():
    text = "Year,Jan,Feb\n1880,abc,.1\n"
    with pytest.raises(GistempError, match="1880"):
        parse_table_csv(text)


def test_table_series_drops_unpublished_months_and_records_the_file():
    rows = parse_table_csv((FIXTURES / "GLB_sample.csv").read_text(encoding="utf-8"))

    series = build_table_series(
        rows,
        location_id="global",
        table="GLB.Ts+dSST.csv",
        last_modified="2026-11-10T13:53:24Z",
        retrieved_at="2026-11-14T21:39:43Z",
    )

    assert series.file == "series/gistemp_anom__global__area_mean.json"
    assert series.aggregation == "area_mean"
    assert series.grid is None
    assert series.unit == "K"
    assert series.points[0]["month"] == "1880-01-01"
    # 2026-10 是最後一個有值的月份；2026-11、2026-12 是 ***
    assert series.points[-1]["month"] == "2026-10-01"
    assert series.points[-1]["value"] == 1.55
    assert series.request["file"] == "GLB.Ts+dSST.csv"
    assert (
        series.request["url"]
        == "https://data.giss.nasa.gov/gistemp/tabledata_v4/GLB.Ts+dSST.csv"
    )
    assert series.request["baseline"] == "1951-1980"
    assert series.request["file_last_modified"] == "2026-11-10T13:53:24Z"
    assert "官方" in series.request["note"]


def test_hemisphere_tables_map_to_the_new_location_ids():
    assert HEMISPHERES == {
        "northern_hemisphere": "NH.Ts+dSST.csv",
        "southern_hemisphere": "SH.Ts+dSST.csv",
    }
