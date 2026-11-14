"""Planetary Computer：STAC 查詢、SAS 簽名、COG 視窗讀取到區域統計量，全程不連網。

合成 raster 的設計（期望值都是手算的）：
球面 sinusoidal，像元邊長 = 0.1° 的弧長，所以每列的緯度差 0.1°，
像元中心經度 = (110 + 0.1 × (欄 + 0.5)) ÷ cos(緯度)。兩個 tile 左右相鄰，各 4 欄 × 3 列：

    列 0（緯度 24.05）：120.51 120.62 120.73 120.84 | 120.95 121.06 121.17 121.28
    列 1（緯度 23.95）：120.42 120.53 120.64 120.75 | 120.86 120.97 121.07 121.18
    列 2（緯度 23.85）：120.32 120.43 120.54 120.65 | 120.76 120.87 120.98 121.09

區域 bbox = [120.6, 23.9, 121.0, 24.1]：列 0 取欄 1–4、列 1 取欄 2–5、列 2 不取。
列 1 比列 0 往東偏一欄，所以用矩形視窗直接平均會算錯。
"""

import io
import json
import math
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
import rasterio
from rasterio.crs import CRS
from rasterio.transform import Affine

from trend_detective import planetary_computer as pc

RADIUS = 6371007.181
PIXEL = RADIUS * math.radians(0.1)
SINUSOIDAL = CRS.from_proj4(f"+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R={RADIUS} +units=m")
BBOX = (120.6, 23.9, 121.0, 24.1)
TOKEN = "sv=2026&sig=SECRET-SIGNATURE"
BLOB_HOST = "https://modiseuwest.blob.core.windows.net/modis-061-cogs"

# 0 是 fill value；在 bbox 內的有值像元是 15010、15020、15040、15100、15110、15120
WEST_TILE = [
    [15000, 15010, 15020, 0],
    [16000, 16000, 15100, 15110],
    [17000, 17000, 17000, 17000],
]
EAST_TILE = [
    [15040, 18000, 18000, 18000],
    [15120, 0, 18000, 18000],
    [17000, 17000, 17000, 17000],
]
# 上面六個值 × 0.02 的手算結果：和 90400 ÷ 6 × 0.02
EXPECTED_MEAN = 301.3333333333333
# 與平均的差（原始值）平方和 11933.33，÷ 6 開根號 44.597，× 0.02
EXPECTED_STD = 0.8919392106839
VARIABLE = {
    "id": "modis_lst_pc",
    "source": "planetary_computer",
    "source_variable_id": "LST_Day_1km",
    "pc_collection": "modis-11A2-061",
    "pc_item_prefix": "MOD11A2.",
    "product": "MOD11A2.061",
    "product_version": "061",
    "native_temporal_res": "8day",
    "is_nasa": True,
    "unit": "K",
    "valid_range": [270, 330],
}
REGION = {"id": "central", "kind": "region", "bbox": list(BBOX)}


def _geotiff(values: list[list[int]], *, first_column: int) -> bytes:
    """4 欄 × 3 列的 uint16 GeoTIFF；scale 0.02、nodata 0、單位 K 寫在檔案 metadata 裡。"""
    data = np.array(values, dtype=np.uint16)
    transform = Affine(
        PIXEL,
        0,
        RADIUS * math.radians(110.0) + first_column * PIXEL,
        0,
        -PIXEL,
        RADIUS * math.radians(24.1),
    )
    buffer = io.BytesIO()
    with rasterio.open(
        buffer,
        "w",
        driver="GTiff",
        height=data.shape[0],
        width=data.shape[1],
        count=1,
        dtype="uint16",
        crs=SINUSOIDAL,
        transform=transform,
        nodata=0,
    ) as dataset:
        dataset.write(data, 1)
        dataset.scales = (0.02,)
        dataset.units = ("K",)
    return buffer.getvalue()


def _pixels(values: list[list[int]], *, first_column: int, tile: str) -> pc.TilePixels:
    with rasterio.open(
        io.BytesIO(_geotiff(values, first_column=first_column))
    ) as dataset:
        pixels = pc.read_tile_pixels(dataset, BBOX, tile=tile, item_id=f"item-{tile}")
    assert pixels is not None
    return pixels


def test_pixel_centres_are_converted_from_sinusoidal_to_lon_lat():
    lon, lat = pc.sinusoidal_to_lonlat(
        np.array([RADIUS * math.radians(110.15)]),
        np.array([RADIUS * math.radians(24.05)]),
        RADIUS,
    )

    assert lat[0] == pytest.approx(24.05)
    # 110.15 ÷ cos(24.05°) = 110.15 ÷ 0.913190
    assert lon[0] == pytest.approx(120.6211, abs=1e-3)


def test_region_mean_merges_tiles_and_skips_fill_and_pixels_outside_bbox():
    tiles = [
        _pixels(WEST_TILE, first_column=0, tile="h28v06"),
        _pixels(EAST_TILE, first_column=4, tile="h29v06"),
    ]

    stat = pc.region_statistics(tiles, BBOX)

    assert stat.count == 6
    assert stat.pixels_in_bbox == 8
    assert stat.mean == pytest.approx(EXPECTED_MEAN)
    assert stat.standard_deviation == pytest.approx(EXPECTED_STD, abs=1e-6)
    assert stat.minimum == pytest.approx(300.2)
    assert stat.maximum == pytest.approx(302.4)
    assert stat.tiles == ("h28v06", "h29v06")


def test_single_tile_gives_only_its_own_pixels():
    stat = pc.region_statistics(
        [_pixels(WEST_TILE, first_column=0, tile="h28v06")], BBOX
    )

    # 西邊 tile 在 bbox 內：15010、15020、fill、15100、15110
    assert (stat.count, stat.pixels_in_bbox) == (4, 5)
    assert stat.mean == pytest.approx((15010 + 15020 + 15100 + 15110) / 4 * 0.02)


def test_pixel_centre_on_the_bbox_edge_counts_and_just_outside_does_not():
    tile = pc.TilePixels(
        tile="h29v06",
        item_id="item",
        raw=np.array([[14000, 15000, 16000]], dtype=np.uint16),
        lon=np.array([[120.6, 121.0, 121.0001]]),
        lat=np.array([[23.9, 24.1, 24.0]]),
        scale=0.02,
        offset=0.0,
        nodata=0,
        unit="K",
    )

    stat = pc.region_statistics([tile], BBOX)

    assert stat.count == 2
    assert stat.mean == pytest.approx(290.0)


def test_region_without_any_valid_pixel_has_no_mean():
    all_fill = [[0, 0, 0, 0]] * 3

    stat = pc.region_statistics(
        [_pixels(all_fill, first_column=0, tile="h28v06")], BBOX
    )

    assert (stat.count, stat.mean, stat.pixels_in_bbox) == (0, None, 5)


def test_tile_that_does_not_reach_the_bbox_is_skipped():
    with rasterio.open(io.BytesIO(_geotiff(WEST_TILE, first_column=40))) as dataset:
        assert pc.read_tile_pixels(dataset, BBOX, tile="h30v06", item_id="x") is None


# ---- 以下經 HTTP：STAC、SAS token、Range 讀檔都由 MockTransport 扮演 ----


def _item(
    day: str, tile: tuple[int, int], *, platform: str = "terra", stamp: str = "1"
) -> dict[str, Any]:
    product = "MOD11A2" if platform == "terra" else "MYD11A2"
    item_id = f"{product}.A{day.replace('-', '')}.h{tile[0]}v{tile[1]:02d}.061.{stamp}"
    return {
        "id": item_id,
        "properties": {
            # 2024–2025 有一段 item 沒有 platform 屬性：不能靠它分辨衛星
            **({} if platform == "terra" else {"platform": platform}),
            "start_datetime": f"{day}T00:00:00Z",
            "modis:horizontal-tile": tile[0],
            "modis:vertical-tile": tile[1],
        },
        "assets": {"LST_Day_1km": {"href": f"{BLOB_HOST}/{item_id}_LST_Day_1km.tif"}},
    }


class Service:
    """假的 Planetary Computer：記下收到的請求，照劇本回應。"""

    def __init__(self, items: list[dict[str, Any]], files: dict[str, bytes]) -> None:
        self.items = items
        self.files = files
        self.searches: list[dict[str, Any]] = []
        self.token_requests: list[str] = []
        self.blob_requests: list[httpx.Request] = []
        self.expiry = "2099-01-01T00:00:00Z"
        # 讀檔時先回這些狀態碼，用完才回正常內容
        self.blob_failures: list[int] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/search"):
            body = json.loads(request.content)
            self.searches.append(body)
            # 分兩頁回，第二頁靠 next 連結的 body 取得
            if "token" not in body:
                next_link = {
                    "rel": "next",
                    "method": "POST",
                    "href": str(request.url),
                    "body": {**body, "token": "next:1"},
                }
                return httpx.Response(
                    200, json={"features": self.items[:1], "links": [next_link]}
                )
            return httpx.Response(200, json={"features": self.items[1:], "links": []})
        if "/sas/v1/token/" in request.url.path:
            self.token_requests.append(request.url.path)
            return httpx.Response(
                200, json={"token": TOKEN, "msft:expiry": self.expiry}
            )
        if request.url.host == "modiseuwest.blob.core.windows.net":
            self.blob_requests.append(request)
            if request.url.query.decode() != TOKEN:
                return httpx.Response(409)
            if self.blob_failures:
                return httpx.Response(self.blob_failures.pop(0))
            content = self.files[request.url.path.rsplit("/", 1)[1]]
            first, last = request.headers["range"].removeprefix("bytes=").split("-")
            part = content[int(first) : int(last) + 1]
            return httpx.Response(
                206,
                content=part,
                headers={
                    "content-range": f"bytes {first}-{int(first) + len(part) - 1}/{len(content)}"
                },
            )
        return httpx.Response(404)


def _service() -> Service:
    items = [
        _item("2020-01-01", (28, 6)),
        _item("2020-01-01", (29, 6)),
        # Aqua 的同一合成期：不該被算進去
        _item("2020-01-01", (29, 6), platform="aqua"),
        # 起始日早於 2001-01-01 的合成期：查詢區間有重疊所以會回來，但不收
        _item("2000-12-26", (29, 6)),
    ]
    files = {
        "MOD11A2.A20200101.h28v06.061.1_LST_Day_1km.tif": _geotiff(
            WEST_TILE, first_column=0
        ),
        "MOD11A2.A20200101.h29v06.061.1_LST_Day_1km.tif": _geotiff(
            EAST_TILE, first_column=4
        ),
        "MYD11A2.A20200101.h29v06.061.1_LST_Day_1km.tif": _geotiff(
            [[20000] * 4] * 3, first_column=4
        ),
        "MOD11A2.A20001226.h29v06.061.1_LST_Day_1km.tif": _geotiff(
            [[20000] * 4] * 3, first_column=4
        ),
    }
    return Service(items, files)


def _fetch(service: Service, raw_dir: Path, **kwargs: Any) -> dict[str, Any]:
    with httpx.Client(transport=httpx.MockTransport(service)) as http:
        return pc.fetch_variable(
            http,
            VARIABLE,
            [REGION],
            raw_dir,
            today=date(2020, 1, 31),
            workers=2,
            sleep=kwargs.pop("sleep", lambda _: None),
            **kwargs,
        )


def test_fetch_writes_one_row_per_composite_and_region_from_terra_items_only(
    tmp_path: Path,
):
    service = _service()

    summary = _fetch(service, tmp_path)

    rows = pc.read_stats(tmp_path / "planetary_computer" / "modis_lst_pc" / "stats.csv")
    assert list(rows) == [("2020-01-01", "central")]
    row = rows[("2020-01-01", "central")]
    assert int(row["count"]) == 6
    assert float(row["mean"]) == pytest.approx(EXPECTED_MEAN)
    assert row["tiles"] == "h28v06;h29v06"
    assert row["item_ids"] == (
        "MOD11A2.A20200101.h28v06.061.1;MOD11A2.A20200101.h29v06.061.1"
    )
    assert summary["failures"] == {}
    assert summary["tiles"] == ["h28v06", "h29v06"]
    # 查詢條件：collection、bbox；有跟著 next 連結翻到第二頁
    assert service.searches[0]["collections"] == ["modis-11A2-061"]
    assert service.searches[0]["bbox"] == list(BBOX)
    assert [s.get("token") for s in service.searches] == [None, "next:1"]
    # scale、fill value、單位是從檔案讀到的
    assert summary["file_metadata"]["scale"] == 0.02
    assert summary["file_metadata"]["nodata"] == 0
    assert summary["file_metadata"]["unit"] == "K"


def test_token_is_fetched_per_container_reused_and_never_written_to_disk(
    tmp_path: Path,
):
    service = _service()

    _fetch(service, tmp_path)

    assert service.token_requests == ["/api/sas/v1/token/modiseuwest/modis-061-cogs"]
    assert len(service.blob_requests) >= 2
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert "SECRET-SIGNATURE" not in path.read_text(encoding="utf-8")


def test_rerun_does_not_download_composites_already_in_stats(tmp_path: Path):
    _fetch(_service(), tmp_path)
    again = _service()

    summary = _fetch(again, tmp_path)

    assert again.blob_requests == []
    assert summary["n_composites_computed"] == 0
    assert summary["downloaded_bytes"] == 0


def test_reprocessed_item_replaces_the_earlier_result(tmp_path: Path):
    _fetch(_service(), tmp_path)
    updated = _service()
    # 西邊 tile 重新產製：id 換了，內容全部變成 fill
    updated.items[0] = _item("2020-01-01", (28, 6), stamp="2")
    updated.files["MOD11A2.A20200101.h28v06.061.2_LST_Day_1km.tif"] = _geotiff(
        [[0] * 4] * 3, first_column=0
    )

    _fetch(updated, tmp_path)

    rows = pc.read_stats(tmp_path / "planetary_computer" / "modis_lst_pc" / "stats.csv")
    row = rows[("2020-01-01", "central")]
    # 只剩東邊 tile 的 15040、15120
    assert int(row["count"]) == 2
    assert float(row["mean"]) == pytest.approx(301.6)


def test_throttled_read_is_retried_after_backing_off(tmp_path: Path):
    service = _service()
    service.blob_failures = [429, 503]
    waits: list[float] = []

    summary = _fetch(service, tmp_path, sleep=waits.append)

    assert summary["failures"] == {}
    assert len(waits) == 2
    assert all(wait >= 1 for wait in waits)


def test_failed_composite_is_reported_without_the_token_and_not_written(
    tmp_path: Path,
):
    service = _service()
    service.blob_failures = [404] * 20

    summary = _fetch(service, tmp_path)

    assert list(summary["failures"]) == ["2020-01-01"]
    assert "SECRET-SIGNATURE" not in json.dumps(summary)
    assert not (tmp_path / "planetary_computer" / "modis_lst_pc" / "stats.csv").exists()


def test_token_close_to_expiry_is_replaced_before_use():
    service = _service()
    clock = [datetime(2026, 11, 14, 12, 0, tzinfo=UTC)]
    service.expiry = "2026-11-14T12:45:00Z"
    href = f"{BLOB_HOST}/a.tif"
    with httpx.Client(transport=httpx.MockTransport(service)) as http:
        tokens = pc.SasTokens(http, now=lambda: clock[0])
        first = tokens.sign(href)
        clock[0] += timedelta(minutes=30)
        tokens.sign(href)
        assert len(service.token_requests) == 1
        # 剩 3 分鐘就過期：換新的
        clock[0] += timedelta(minutes=12)
        tokens.sign(href)

    assert first == f"{href}?{TOKEN}"
    assert len(service.token_requests) == 2


def test_file_scale_written_as_divisor_is_reconciled_with_the_stac_scale():
    # MOD13 的檔案寫 scale_factor = 10000（除數），STAC 寫 0.0001（乘數）
    assert pc.effective_scale(10000.0, 0.0001) == 0.0001
    assert pc.effective_scale(0.02, 0.02) == 0.02
    assert pc.effective_scale(0.02, None) == 0.02
    with pytest.raises(pc.PlanetaryComputerError, match="對不上"):
        pc.effective_scale(0.02, 0.0001)


def test_ndvi_style_tile_is_scaled_by_the_multiplier_not_the_divisor():
    data = np.array([[5000, -3000, 7000, 6000]] * 3, dtype=np.int16)
    transform = Affine(
        PIXEL, 0, RADIUS * math.radians(110.0), 0, -PIXEL, RADIUS * math.radians(24.1)
    )
    buffer = io.BytesIO()
    with rasterio.open(
        buffer,
        "w",
        driver="GTiff",
        height=3,
        width=4,
        count=1,
        dtype="int16",
        crs=SINUSOIDAL,
        transform=transform,
        nodata=-3000,
    ) as dataset:
        dataset.write(data, 1)
        dataset.scales = (10000.0,)
    buffer.seek(0)
    with rasterio.open(buffer) as dataset:
        pixels = pc.read_tile_pixels(
            dataset, BBOX, tile="h28v06", item_id="x", declared_scale=0.0001
        )
    assert pixels is not None

    stat = pc.region_statistics([pixels], BBOX)

    # bbox 內：列 0 的欄 1–3（fill、7000、6000）與列 1 的欄 2–3（7000、6000）
    assert stat.count == 4
    assert stat.mean == pytest.approx(0.65)


# --- 點位取樣（#51）---
# 點位視窗用的 raster（4 欄 × 3 列，第 0 欄貼著 110° 的 tile 邊界）。0 是 fill value。
POINT_TILE = [
    [15000, 15010, 0, 9999],
    [15100, 15110, 15120, 9999],
    [15200, 0, 15220, 9999],
]


def _window(lon: float, lat: float, size: int = 3) -> pc.TilePixels | None:
    with rasterio.open(io.BytesIO(_geotiff(POINT_TILE, first_column=0))) as dataset:
        return pc.read_point_window(
            dataset, lon, lat, size, tile="h28v06", item_id="item"
        )


def test_point_window_is_the_block_centred_on_the_pixel_holding_the_point():
    # (120.53, 23.95)：x = 120.53 × cos(23.95°) = 110.15°，落在欄 1、列 1
    pixels = _window(120.53, 23.95)

    assert pixels is not None
    assert pixels.raw.tolist() == [row[:3] for row in POINT_TILE]
    stat = pc.region_statistics([pixels], pc.EVERYWHERE)
    # 9 個像元裡 2 個是 fill value；其餘 7 個的和 105760 ÷ 7 × 0.02
    assert (stat.pixels_in_bbox, stat.count) == (9, 7)
    assert stat.mean == pytest.approx(105760 / 7 * 0.02)
    assert stat.minimum == pytest.approx(300.0)
    assert stat.maximum == pytest.approx(304.4)


def test_point_window_is_clipped_at_the_edge_of_the_file():
    # (120.51, 24.05)：欄 0、列 0，視窗只剩左上角 2 × 2
    pixels = _window(120.51, 24.05)

    assert pixels is not None
    assert pixels.raw.tolist() == [[15000, 15010], [15100, 15110]]
    stat = pc.region_statistics([pixels], pc.EVERYWHERE)
    assert (stat.pixels_in_bbox, stat.count) == (4, 4)
    # (15000 + 15010 + 15100 + 15110) ÷ 4 × 0.02
    assert stat.mean == pytest.approx(301.1)


def test_point_outside_the_file_gives_no_window():
    # 121.5 × cos(24.05°) = 110.95°：欄 9，超出 4 欄
    assert _window(121.5, 24.05) is None
    # 緯度 24.2 在第一列（24.0–24.1）之上
    assert _window(120.53, 24.2) is None


def test_window_of_one_pixel_is_just_the_pixel_and_even_sizes_are_rejected():
    pixels = _window(120.53, 23.95, size=1)
    assert pixels is not None
    assert pixels.raw.tolist() == [[15110]]
    with pytest.raises(pc.PlanetaryComputerError, match="奇數"):
        _window(120.53, 23.95, size=2)


def test_fetch_for_points_writes_the_window_mean_of_the_tile_holding_each_point(
    tmp_path: Path,
):
    service = _service()
    variable = pc.point_variable(
        {
            **VARIABLE,
            "id": "modis_lst",
            "source": "appeears",
            "point_source": {
                "source": "planetary_computer",
                "pc_collection": "modis-11A2-061",
                "window_pixels": 3,
            },
        }
    )
    assert variable is not None
    points = [
        # 西邊 tile 的欄 1、列 1
        {"id": "west_point", "kind": "point", "lat": 23.95, "lon": 120.53},
        # 121.07 × cos(23.95°) = 110.65°：全域欄 6，也就是東邊 tile 的欄 2、列 1
        {"id": "east_point", "kind": "point", "lat": 23.95, "lon": 121.07},
    ]

    with httpx.Client(transport=httpx.MockTransport(service)) as http:
        summary = pc.fetch_variable(
            http,
            variable,
            points,
            tmp_path,
            today=date(2020, 1, 31),
            workers=2,
            sleep=lambda _: None,
        )

    assert summary["failures"] == {}
    assert summary["window_pixels"] == 3
    rows = pc.read_stats(tmp_path / "planetary_computer" / "modis_lst" / "stats.csv")
    assert sorted(rows) == [("2020-01-01", "east_point"), ("2020-01-01", "west_point")]
    west = rows[("2020-01-01", "west_point")]
    # WEST_TILE 的欄 0–2 共 9 個值，和 143130 ÷ 9 × 0.02
    assert (int(west["count"]), int(west["pixels_in_bbox"])) == (9, 9)
    assert float(west["mean"]) == pytest.approx(143130 / 9 * 0.02)
    assert west["tiles"] == "h28v06"
    assert west["item_ids"] == "MOD11A2.A20200101.h28v06.061.1"
    east = rows[("2020-01-01", "east_point")]
    # EAST_TILE 的欄 1–3：一個 fill value，其餘 5 × 18000 + 3 × 17000 = 141000，÷ 8 × 0.02
    assert (int(east["count"]), int(east["pixels_in_bbox"])) == (8, 9)
    assert float(east["mean"]) == pytest.approx(352.5)
    assert east["tiles"] == "h29v06"
    # 查詢的 bbox 是點位的外框；token 沒有寫進任何檔案
    assert service.searches[0]["bbox"] == [120.53, 23.95, 121.07, 23.95]
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert "SECRET-SIGNATURE" not in path.read_text(encoding="utf-8")


def test_variable_without_a_planetary_computer_point_source_has_no_point_fetch():
    assert pc.point_variable(VARIABLE) is None
    assert pc.point_variable({**VARIABLE, "point_source": {"source": "other"}}) is None
