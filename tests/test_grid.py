"""全球格點：立方體讀寫、面積加權降解析度、逐年平均與前端衍生檔。期望值皆手算。"""

import json
import math
from datetime import date
from pathlib import Path

import netCDF4
import numpy as np
import pytest

from trend_detective.grid import (
    MISSING,
    Cube,
    Grid,
    GridError,
    Layers,
    annual_means,
    area_weights,
    cell_edges,
    global_mean,
    monthly_climatology,
    read_cube,
    read_frontend,
    read_month_file,
    regrid,
    write_cube,
    write_frontend,
)

NAN = float("nan")


def months_of(*years: int) -> list[date]:
    return [date(year, month, 1) for year in years for month in range(1, 13)]


def write_month_file(path: Path, values: list[list[float]], fill: float) -> None:
    with netCDF4.Dataset(path, "w") as dataset:
        dataset.createDimension("time", 1)
        dataset.createDimension("lat", 2)
        dataset.createDimension("lon", 2)
        dataset.createVariable("lat", "f8", ("lat",))[:] = [10.0, 20.0]
        dataset.createVariable("lon", "f8", ("lon",))[:] = [100.0, 110.0]
        var = dataset.createVariable("T", "f4", ("time", "lat", "lon"), fill_value=fill)
        var.units = "K"
        var.set_auto_mask(False)
        var[:] = np.array([values], dtype=np.float32)


def test_month_file_fill_values_are_read_as_nan(tmp_path: Path):
    path = tmp_path / "200101.nc4"
    write_month_file(path, [[280.0, 1e15], [290.0, 300.0]], fill=1e15)

    lat, lon, values, unit = read_month_file(path, "T")

    assert lat.tolist() == [10.0, 20.0]
    assert lon.tolist() == [100.0, 110.0]
    assert unit == "K"
    assert values[0, 0] == 280.0 and math.isnan(values[0, 1])
    assert values[1].tolist() == [290.0, 300.0]


def test_month_file_without_the_variable_is_an_error(tmp_path: Path):
    path = tmp_path / "200101.nc4"
    write_month_file(path, [[1.0, 2.0], [3.0, 4.0]], fill=-9999.0)

    with pytest.raises(GridError, match="沒有變數 X"):
        read_month_file(path, "X")


def test_cube_survives_a_write_and_read_round_trip(tmp_path: Path):
    cube = Cube(
        months=[date(2001, 1, 1), date(2001, 2, 1)],
        lat=np.array([-0.5, 0.5]),
        lon=np.array([10.0, 11.0, 12.0]),
        values=np.array(
            [[[1.0, 2.0, NAN], [4.0, 5.0, 6.0]], [[7.0, 8.0, 9.0], [10.0, 11.0, 12.0]]],
            dtype=np.float32,
        ),
        unit="K",
        attrs={"doi": "10.1234/TEST"},
    )
    path = tmp_path / "sub" / "cube.nc"

    write_cube(path, cube, "T2M")
    loaded = read_cube(path)

    assert loaded.months == cube.months
    assert loaded.lat.tolist() == [-0.5, 0.5]
    assert loaded.lon.tolist() == [10.0, 11.0, 12.0]
    assert loaded.unit == "K"
    assert loaded.attrs["doi"] == "10.1234/TEST"
    assert loaded.attrs["variable"] == "T2M"
    np.testing.assert_array_equal(loaded.values, cube.values)


def test_cell_edges_are_clipped_at_the_poles():
    edges = cell_edges(np.array([-90.0, 0.0, 90.0]), -90.0, 90.0)

    assert edges.tolist() == [-90.0, -45.0, 45.0, 90.0]


def test_cell_edges_reject_uneven_spacing():
    with pytest.raises(GridError):
        cell_edges(np.array([0.0, 1.0, 3.0]), -90.0, 90.0)


def test_area_weights_follow_the_sine_of_the_cell_edges():
    # 中心 -60、0、60 → 格緣 -90、-30、30、90 → sin 為 -1、-0.5、0.5、1
    weights = area_weights(np.array([-60.0, 0.0, 60.0]))

    assert weights.tolist() == pytest.approx([0.5, 1.0, 0.5])


def test_global_mean_weights_rows_by_area_and_skips_missing():
    # 緯度中心 -60、0、60 → 格緣 -90、-30、30、90 → sin 差 0.5、1、0.5
    lat = np.array([-60.0, 0.0, 60.0])
    values = np.array([[10.0, 10.0], [20.0, 20.0], [40.0, NAN]])

    # (0.5×10×2 + 1×20×2 + 0.5×40) ÷ (0.5×2 + 1×2 + 0.5) = 70 ÷ 3.5
    assert float(global_mean(values, lat)) == pytest.approx(20.0)
    assert math.isnan(float(global_mean(np.full((3, 2), NAN), lat)))


def test_regrid_merges_latitude_bands_by_overlapping_area():
    # 中心 -60、0、60（格緣 -90、-30、30、90）併成 90 度一帶：
    # 南帶 [-90, 0] 含第 0 列（sin 差 0.5）與第 1 列的南半（0.5）
    lat = np.array([-60.0, 0.0, 60.0])
    lon = np.array([-90.0, 90.0])
    values = np.array([[10.0, 30.0], [20.0, 40.0], [50.0, 70.0]])

    coarse, grid = regrid(values, lat, lon, lat_step=90.0, lon_factor=1)

    assert grid == Grid(
        lat_south=-90.0,
        lat_step=90.0,
        n_lat=2,
        lon_west=-180.0,
        lon_step=180.0,
        n_lon=2,
    )
    np.testing.assert_allclose(coarse, [[15.0, 35.0], [35.0, 55.0]])


def test_regrid_averages_longitude_blocks_and_keeps_leading_axes():
    lat = np.array([-45.0, 45.0])
    lon = np.array([-135.0, -45.0, 45.0, 135.0])
    values = np.array([[[1.0, 3.0, 5.0, 7.0], [2.0, 4.0, 6.0, 8.0]]])

    coarse, grid = regrid(values, lat, lon, lat_step=90.0, lon_factor=2)

    assert coarse.shape == (1, 2, 2)
    assert coarse[0].tolist() == [[2.0, 6.0], [3.0, 7.0]]
    assert (grid.lon_west, grid.lon_step, grid.n_lon) == (-180.0, 180.0, 2)


def test_regrid_ignores_missing_cells_until_less_than_half_the_area_is_valid():
    lat = np.array([-45.0, 45.0])
    lon = np.array([-135.0, -45.0, 45.0, 135.0])
    values = np.array([[1.0, NAN, NAN, NAN], [3.0, 5.0, NAN, 9.0]])

    # 整張併成一格再分東西兩半：西半 3 格有值（1、3、5），東半只有 1 格（不到一半）
    coarse, _ = regrid(values, lat, lon, lat_step=180.0, lon_factor=2)

    assert coarse[0, 0] == pytest.approx(3.0)
    assert math.isnan(coarse[0, 1])

    lenient, _ = regrid(values, lat, lon, lat_step=180.0, lon_factor=2, min_valid=0.0)
    assert lenient[0, 1] == pytest.approx(9.0)


def test_regrid_rejects_a_longitude_factor_that_does_not_divide_the_grid():
    with pytest.raises(GridError, match="整除"):
        regrid(
            np.zeros((2, 3)),
            np.array([-45.0, 45.0]),
            np.array([0.0, 1.0, 2.0]),
            lat_step=90.0,
            lon_factor=2,
        )


def test_annual_mean_weights_months_by_days_and_drops_incomplete_years():
    months = [*months_of(2001), date(2002, 1, 1), date(2002, 2, 1)]
    values = np.zeros((14, 1, 1), dtype=np.float32)
    values[0] = 365.0  # 2001 年 1 月（31 天），其餘月份為 0
    values[12:] = 99.0

    years, annual = annual_means(months, values)

    assert years == [2001]
    assert annual[:, 0, 0].tolist() == pytest.approx([31.0])


def test_annual_mean_is_missing_where_any_month_is_missing():
    values = np.ones((12, 1, 2), dtype=np.float32)
    values[5, 0, 1] = NAN

    _, annual = annual_means(months_of(2001), values)

    assert annual[0, 0, 0] == pytest.approx(1.0)
    assert math.isnan(annual[0, 0, 1])


def test_monthly_climatology_averages_the_same_month_across_complete_years():
    months = [*months_of(2001, 2002), date(2003, 1, 1)]
    values = np.zeros((25, 1, 1), dtype=np.float32)
    values[0], values[12], values[24] = (
        10.0,
        20.0,
        999.0,
    )  # 三個 1 月，第三個不在齊全年份
    values[2], values[14] = 1.0, 4.0  # 兩個 3 月

    years, climatology = monthly_climatology(months, values)

    assert years == [2001, 2002]
    assert climatology.shape == (12, 1, 1)
    assert climatology[:3, 0, 0].tolist() == pytest.approx([15.0, 0.0, 2.5])


def test_monthly_climatology_needs_one_complete_year():
    with pytest.raises(GridError):
        monthly_climatology([date(2001, 1, 1)], np.zeros((1, 1, 1)))


def test_frontend_files_are_little_endian_int16_with_scale_offset_and_missing(
    tmp_path: Path,
):
    grid = Grid(
        lat_south=-90.0,
        lat_step=90.0,
        n_lat=2,
        lon_west=-180.0,
        lon_step=180.0,
        n_lon=2,
    )
    values = np.array(
        [[[273.15, 274.15], [272.65, NAN]], [[283.15, 273.16], [273.15, 273.15]]],
        dtype=np.float64,
    )
    layers = Layers(
        name="annual_mean",
        description="逐年平均",
        unit="K",
        labels=["2001", "2002"],
        values=values,
        scale=0.01,
        offset=273.15,
    )

    written = write_frontend(tmp_path, {"id": "demo", "unit": "K"}, grid, [layers])

    assert [path.name for path in written] == ["annual_mean.i16", "meta.json"]
    raw = (tmp_path / "annual_mean.i16").read_bytes()
    assert len(raw) == 2 * 2 * 2 * 2
    assert np.frombuffer(raw, dtype="<i2").tolist() == [
        0, 100, -50, MISSING, 1000, 1, 0, 0,
    ]  # fmt: skip
    meta = json.loads((tmp_path / "meta.json").read_text(encoding="utf-8"))
    assert meta["id"] == "demo"
    assert meta["grid"]["n_lat"] == 2 and meta["grid"]["lon_step"] == 180.0
    assert meta["encoding"]["missing"] == -32768
    assert meta["layers"][0]["labels"] == ["2001", "2002"]
    assert meta["layers"][0]["bytes"] == 16

    loaded_meta, arrays = read_frontend(tmp_path)
    assert loaded_meta == meta
    decoded = arrays["annual_mean"]
    assert decoded.shape == (2, 2, 2)
    assert decoded[0, 0].tolist() == pytest.approx([273.15, 274.15])
    assert decoded[0, 1, 0] == pytest.approx(272.65)
    assert math.isnan(decoded[0, 1, 1])


def test_frontend_rewrite_with_the_same_content_is_byte_identical(tmp_path: Path):
    grid = Grid(
        lat_south=0.0, lat_step=1.0, n_lat=1, lon_west=0.0, lon_step=1.0, n_lon=1
    )
    layers = Layers("x", "", "K", ["a"], np.array([[[1.0]]]), scale=0.5)

    write_frontend(tmp_path, {"id": "demo"}, grid, [layers])
    first = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    write_frontend(tmp_path, {"id": "demo"}, grid, [layers])

    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == first


def test_frontend_refuses_values_that_do_not_fit_int16(tmp_path: Path):
    grid = Grid(
        lat_south=0.0, lat_step=1.0, n_lat=1, lon_west=0.0, lon_step=1.0, n_lon=1
    )
    layers = Layers("x", "", "K", ["a"], np.array([[[400.0]]]), scale=0.01)

    with pytest.raises(GridError, match="int16"):
        write_frontend(tmp_path, {}, grid, [layers])


def test_frontend_refuses_layers_whose_shape_differs_from_the_grid(tmp_path: Path):
    grid = Grid(
        lat_south=0.0, lat_step=1.0, n_lat=2, lon_west=0.0, lon_step=1.0, n_lon=1
    )
    layers = Layers("x", "", "K", ["a"], np.array([[[1.0]]]), scale=1.0)

    with pytest.raises(GridError, match="形狀"):
        write_frontend(tmp_path, {}, grid, [layers])


def test_month_files_with_groups_and_other_axis_orders_come_out_south_to_north(
    tmp_path: Path,
):
    # IMERG 的排法：群組裡 (time, lon, lat)；緯度刻意由北到南（AIRS 的排法）
    path = tmp_path / "200101.nc4"
    with netCDF4.Dataset(path, "w") as dataset:
        group = dataset.createGroup("Grid")
        group.createDimension("time", 1)
        group.createDimension("lon", 3)
        group.createDimension("lat", 2)
        group.createVariable("lat", "f4", ("lat",))[:] = [20.0, 10.0]
        group.createVariable("lon", "f4", ("lon",))[:] = [100.0, 110.0, 120.0]
        var = group.createVariable(
            "rain", "f4", ("time", "lon", "lat"), fill_value=-9999.9
        )
        var.Units = "mm/hr"
        var.set_auto_mask(False)
        # [lon][lat]：lon=100 → (lat20: 1, lat10: 2)、lon=110 → (3, 4)、lon=120 → (缺, 6)
        var[:] = np.array([[[1.0, 2.0], [3.0, 4.0], [-9999.9, 6.0]]], dtype=np.float32)

    lat, lon, values, unit = read_month_file(
        path, "/Grid/rain", lat="/Grid/lat", lon="/Grid/lon"
    )

    assert lat.tolist() == [10.0, 20.0]
    assert lon.tolist() == [100.0, 110.0, 120.0]
    assert unit == "mm/hr"
    assert values[0].tolist() == [2.0, 4.0, 6.0]
    assert values[1, :2].tolist() == [1.0, 3.0] and math.isnan(values[1, 2])


def test_month_files_without_a_time_axis_or_unit_are_read_too(tmp_path: Path):
    path = tmp_path / "200101.nc4"
    with netCDF4.Dataset(path, "w") as dataset:
        dataset.createDimension("YDim", 2)
        dataset.createDimension("XDim", 2)
        dataset.createVariable("YDim", "f8", ("YDim",))[:] = [-0.5, 0.5]
        dataset.createVariable("XDim", "f8", ("XDim",))[:] = [0.5, 1.5]
        dataset.createVariable("T", "f4", ("YDim", "XDim"))[:] = [
            [1.0, 2.0],
            [3.0, 4.0],
        ]

    lat, _, values, unit = read_month_file(path, "/T", lat="/YDim", lon="/XDim")

    assert lat.tolist() == [-0.5, 0.5]
    assert values.tolist() == [[1.0, 2.0], [3.0, 4.0]]
    assert unit == ""


def test_a_variable_with_an_extra_axis_is_not_a_single_layer(tmp_path: Path):
    path = tmp_path / "200101.nc4"
    with netCDF4.Dataset(path, "w") as dataset:
        dataset.createDimension("level", 3)
        dataset.createDimension("lat", 2)
        dataset.createDimension("lon", 2)
        dataset.createVariable("lat", "f8", ("lat",))[:] = [10.0, 20.0]
        dataset.createVariable("lon", "f8", ("lon",))[:] = [100.0, 110.0]
        dataset.createVariable("T", "f4", ("level", "lat", "lon"))[:] = np.zeros(
            (3, 2, 2)
        )

    with pytest.raises(GridError, match=r"不是 \(1, lat, lon\)"):
        read_month_file(path, "T")


def test_class_layers_are_written_as_uint8_and_read_back_as_codes(tmp_path: Path):
    grid = Grid(
        lat_south=0.0, lat_step=1.0, n_lat=1, lon_west=0.0, lon_step=1.0, n_lon=4
    )
    classes = {"0": "missing", "1": "no", "2": "raw only", "3": "fdr"}
    mask = Layers(
        name="trend_significance",
        description="類別",
        unit="class",
        labels=["2001-01 至 2020-12"],
        values=np.array([[[0, 1, 2, 3]]], dtype=np.uint8),
        scale=1.0,
        dtype="uint8",
        classes=classes,
    )
    number = Layers("x", "", "K", ["a"], np.array([[[1.0, 2.0, NAN, 4.0]]]), scale=0.5)

    written = write_frontend(tmp_path, {"id": "demo"}, grid, [number, mask])

    assert [path.name for path in written] == [
        "x.i16",
        "trend_significance.u8",
        "meta.json",
    ]
    assert (tmp_path / "trend_significance.u8").read_bytes() == bytes([0, 1, 2, 3])
    meta, arrays = read_frontend(tmp_path)
    assert "dtype" not in meta["layers"][0]
    assert meta["layers"][1]["dtype"] == "uint8"
    assert meta["layers"][1]["missing"] == 0
    assert meta["layers"][1]["classes"] == classes
    assert meta["layers"][1]["bytes"] == 4
    assert arrays["trend_significance"][0, 0].tolist() == [0.0, 1.0, 2.0, 3.0]
    assert math.isnan(arrays["x"][0, 0, 2])
