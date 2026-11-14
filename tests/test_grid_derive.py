"""由立方體重產衍生檔與趨勢抽查（#68）：不連網，用小的合成立方體。"""

import json
from datetime import date
from pathlib import Path

import numpy as np
import pytest

from trend_detective.grid import Cube, read_frontend, write_cube
from trend_detective.grid_derive import compare_with_series, derive, main, read_coarse
from trend_detective.grid_fetch import GridProduct
from trend_detective.trends import TrendParams

PRODUCT = GridProduct(
    id="demo",
    name_zh="示範",
    name_en="Demo",
    product="DEMO.1",
    product_version="1",
    collection="C1-X",
    variable="T",
    doi="10.1234/DEMO",
    citation="Demo citation",
    start=date(2001, 1, 1),
    lat_step=90.0,
    lon_factor=2,
    scale=0.01,
    offset=0.0,
    slope_scale=0.001,
)
SEED = [
    {
        "id": "demo",
        "name_zh": "示範",
        "name_en": "Demo",
        "product": "DEMO.1",
        "product_version": "1",
        "collection": "C1-X",
        "variable": "T",
        "doi": "10.1234/DEMO",
        "citation": "Demo citation",
        "start": "2001-01",
        "frontend": {
            "lat_step": 90.0,
            "lon_factor": 2,
            "scale": 0.01,
            "offset": 0.0,
            "slope_scale": 0.001,
        },
    },
    {
        "id": "cube_only",
        "name_zh": "只有立方體",
        "name_en": "Cube only",
        "product": "DEMO.1",
        "product_version": "1",
        "collection": "C1-X",
        "variable": "Q",
        "doi": "10.1234/DEMO",
        "citation": "Demo citation",
        "start": "2001-01",
    },
]


SLOPE = 1.2 * 144 * (12**2 - 1) / (144 * 12**2 - 1)


def write_demo_cube(raw_dir: Path) -> Path:
    """2 × 4 格、144 個月：每月 +0.01（每十年 1.2）加季節循環；西北角那一格沒有資料。

    月距平法對 12 個完整年的純線性趨勢會算出真值 × 144(N² − 1) ÷ (144N² − 1)
    = 1.2 × 0.99310 = 1.19172（解析解，見 test_grid_trends.attenuation）。
    """
    months = [date(2001 + i // 12, i % 12 + 1, 1) for i in range(144)]
    t = np.arange(144, dtype=np.float64)
    series = 10 + 0.01 * t + 3 * np.sin(2 * np.pi * t / 12)
    values = np.repeat(series[:, None, None], 2, axis=1).repeat(4, axis=2)
    values[:, 1, 0] = np.nan
    path = raw_dir / "demo" / "demo.nc"
    write_cube(
        path,
        Cube(
            months=months,
            lat=np.array([-45.0, 45.0]),
            lon=np.array([-135.0, -45.0, 45.0, 135.0]),
            values=values.astype(np.float32),
            unit="K",
            attrs={"access": "test", "first_month": "2001-01", "last_month": "2012-12"},
        ),
        "T",
    )
    return path


def test_cube_is_read_month_by_month_onto_the_frontend_grid(tmp_path: Path):
    built = read_coarse(PRODUCT, write_demo_cube(tmp_path))

    assert built.coarse is not None and built.grid is not None
    assert built.coarse.shape == (144, 2, 2)
    assert (built.grid.n_lat, built.grid.n_lon) == (2, 2)
    assert built.unit == "K"
    assert built.months[0] == date(2001, 1, 1) and built.months[-1] == date(2012, 12, 1)
    # 西北那一格只有一半有值，仍算有效
    assert np.isfinite(built.coarse).all()


def test_derive_writes_trend_maps_and_checks_cells_against_the_series_code(
    tmp_path: Path,
):
    write_demo_cube(tmp_path / "raw")

    result = derive(PRODUCT, tmp_path / "raw", tmp_path / "out", TrendParams())

    meta, arrays = read_frontend(tmp_path / "out" / "demo")
    np.testing.assert_allclose(arrays["trend_slope_per_decade"], SLOPE, atol=6e-4)
    assert (arrays["trend_significance"] == 3).all()
    assert result["trend"] == meta["trend"]
    assert result["files"]["trend_significance.u8"] == 4
    assert result["files"]["trend_slope_per_decade.i16"] == 8
    assert len(result["cell_checks"]) == 3
    for check in result["cell_checks"]:
        assert check["trends_py"]["status"] == "analyzed"
        assert check["trends_py"]["slope_per_decade"] == pytest.approx(SLOPE, abs=1e-5)
        assert check["abs_difference"]["slope_per_decade"] < 1e-9
        assert check["abs_difference"]["p"] < 1e-9


def test_grid_mean_slope_is_compared_with_the_global_mean_series():
    result = {
        "id": "demo",
        "trend": {"area_weighted_mean_slope_per_decade": 0.9},
    }
    series_trends = {
        "series": {
            "demo__global__area_mean_grid": {
                "status": "analyzed",
                "data": {"first_month": "2001-01-01", "last_month": "2012-12-01"},
                "ols": {
                    "slope_per_decade": 1.2,
                    "ci_per_decade": [1.0, 1.4],
                    "p": 0.001,
                },
            }
        }
    }

    check = compare_with_series(result, series_trends)
    missing = compare_with_series(result, None)

    assert check["global_mean_series"]["slope_per_decade"] == 1.2
    assert check["same_sign"] is True
    assert check["ratio_grid_to_series"] == pytest.approx(0.75)
    assert missing["global_mean_series"] is None
    assert missing["grid_area_weighted_mean_slope_per_decade"] == 0.9


def test_command_rebuilds_only_products_with_frontend_settings(tmp_path: Path, capsys):
    write_demo_cube(tmp_path / "raw")
    seed = tmp_path / "grids.json"
    seed.write_text(json.dumps(SEED), encoding="utf-8")
    args = [
        "--seed-file", str(seed),
        "--raw-dir", str(tmp_path / "raw"),
        "--out-dir", str(tmp_path / "out"),
        "--series-trends", str(tmp_path / "none.json"),
        "--report", str(tmp_path / "report" / "grid_trends.report.json"),
        "--workers", "1",
    ]  # fmt: skip

    assert main(args) == 0
    first = {p.name: p.read_bytes() for p in (tmp_path / "out" / "demo").iterdir()}
    assert main(args) == 0
    second = {p.name: p.read_bytes() for p in (tmp_path / "out" / "demo").iterdir()}

    assert first == second  # 沒有時間戳，重產逐位元組相同
    assert not (tmp_path / "out" / "cube_only").exists()
    report = json.loads((tmp_path / "report" / "grid_trends.report.json").read_text())
    assert [item["id"] for item in report["variables"]] == ["demo"]
    assert report["variables"][0]["global_mean_check"]["global_mean_series"] is None
    assert "demo" in capsys.readouterr().out


def test_command_fails_when_a_cube_is_missing(tmp_path: Path):
    seed = tmp_path / "grids.json"
    seed.write_text(json.dumps(SEED), encoding="utf-8")

    assert main(["--seed-file", str(seed), "--raw-dir", str(tmp_path / "raw")]) == 1
