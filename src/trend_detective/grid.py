"""全球格點月資料：立方體（時間 × 緯度 × 經度）的讀寫、降解析度與給前端的衍生檔。

兩種產出（#47）：

- **立方體**：一個 NetCDF-4 檔，原始解析度、原始單位，`data/raw/grid/<id>/<id>.nc`，不進 git。
  用 `read_cube` 讀回；缺值是 NaN，緯度由南到北、經度由西到東。
- **前端衍生檔**：`data/grid/<id>/meta.json` 加幾個 little-endian int16 的二進位檔，進 git。
  每個檔是「層 × 緯度 × 經度」的連續陣列（row-major），`值 = 整數 × scale + offset`，
  缺值是 `MISSING`（-32768）。類別圖層（趨勢的顯著性遮罩，#68）是 uint8 的 `.u8` 檔，
  圖層條目有 `dtype: "uint8"` 與 `classes`，缺值是 0。`read_frontend` 是讀法的參考實作。

這個模組只做數值與檔案格式，不連網；下載在 `grid_fetch.py`。
"""

import calendar
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import netCDF4
import numpy as np
from numpy.typing import NDArray

MISSING = -32768
EPOCH = date(1970, 1, 1)
META_FILE = "meta.json"

Floats = NDArray[np.floating[Any]]


class GridError(ValueError):
    """格點資料的形狀、座標或內容不符合預期。"""


@dataclass(frozen=True)
class Cube:
    """月資料立方體。`values` 是 (時間, 緯度, 經度) 的 float32，缺值為 NaN。"""

    months: list[date]
    lat: Floats
    lon: Floats
    values: Floats
    unit: str
    attrs: dict[str, str]


@dataclass(frozen=True)
class Grid:
    """等間距網格：第一格的南緣與西緣、間距與格數。緯度由南到北、經度由西到東。"""

    lat_south: float
    lat_step: float
    n_lat: int
    lon_west: float
    lon_step: float
    n_lon: int


@dataclass(frozen=True)
class Layers:
    """一個衍生檔：`values` 是 (層, 緯度, 經度)，`labels` 是每一層的名稱（年、月份…）。"""

    name: str
    description: str
    unit: str
    labels: list[str]
    values: Floats | NDArray[np.uint8]
    scale: float
    offset: float = 0.0
    # "int16"（預設，數值圖層）或 "uint8"（類別圖層：值就是類別代碼，0 是缺值）
    dtype: str = "int16"
    classes: dict[str, str] | None = None


def _variable(dataset: netCDF4.Dataset, path: Path, name: str) -> Any:
    try:
        return dataset[name]
    except (IndexError, KeyError):
        raise GridError(f"{path.name} 裡沒有變數 {name}") from None


def read_month_file(
    path: Path, variable: str, *, lat: str = "lat", lon: str = "lon"
) -> tuple[Floats, Floats, Floats, str]:
    """讀單月的 NetCDF 子集，回傳 (lat, lon, 二維值, 單位)；fill value 轉成 NaN。

    `variable`、`lat`、`lon` 可以是群組路徑（`/Grid/precipitation`）。檔案裡的軸順序
    （IMERG 是 lon × lat）與方向（AIRS 的緯度由北到南）都轉成緯度由南到北、經度由西到東；
    長度為 1 的時間軸可有可無。沒有 `units` 屬性時單位是空字串。
    """
    with netCDF4.Dataset(path) as dataset:
        var = _variable(dataset, path, variable)
        lat_var = _variable(dataset, path, lat)
        lon_var = _variable(dataset, path, lon)
        var.set_auto_mask(False)
        raw = np.asarray(var[:], dtype=np.float32)
        axes = (lat_var.dimensions[0], lon_var.dimensions[0])
        kept = [
            (name, size)
            for name, size in zip(var.dimensions, raw.shape, strict=True)
            if name in axes
        ]
        if sorted(name for name, _ in kept) != sorted(axes) or raw.size != (
            kept[0][1] * kept[1][1]
        ):
            raise GridError(
                f"{path.name} 的 {variable} 不是 (1, lat, lon)：{raw.shape}"
            )
        values = raw.reshape([size for _, size in kept])
        if kept[0][0] != axes[0]:
            values = values.T
        attrs = set(var.ncattrs())
        for name in ("_FillValue", "missing_value", "MissingValue"):
            if name in attrs:
                fill = np.float32(np.asarray(var.getncattr(name)).ravel()[0])
                values = np.where(values == fill, np.nan, values)
        lat_values = np.asarray(lat_var[:], dtype=np.float64)
        lon_values = np.asarray(lon_var[:], dtype=np.float64)
        unit = next(
            (str(var.getncattr(name)) for name in ("units", "Units") if name in attrs),
            "",
        )
    if lat_values[0] > lat_values[-1]:
        lat_values, values = lat_values[::-1], values[::-1]
    if lon_values[0] > lon_values[-1]:
        lon_values, values = lon_values[::-1], values[:, ::-1]
    return lat_values, lon_values, np.ascontiguousarray(values, np.float32), unit


def write_cube_layers(
    path: Path,
    variable: str,
    months: list[date],
    lat: Floats,
    lon: Floats,
    unit: str,
    attrs: dict[str, str],
    layers: Iterable[Floats],
) -> None:
    """把逐月的二維值一層一層寫成壓縮的 NetCDF-4 立方體（先寫暫存檔再改名）。

    `layers` 依 `months` 的順序給出 (緯度, 經度)；一次只有一個月在記憶體裡，
    0.1° 的產品（IMERG、FLDAS，每個月 2 千萬格以上）也不必整個載入。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(".part")
    with netCDF4.Dataset(temp, "w", format="NETCDF4") as dataset:
        dataset.createDimension("time", len(months))
        dataset.createDimension("lat", len(lat))
        dataset.createDimension("lon", len(lon))
        time = dataset.createVariable("time", "i4", ("time",))
        time.units = "days since 1970-01-01"
        time.calendar = "standard"
        time.long_name = "first day of the month"
        time[:] = [(month - EPOCH).days for month in months]
        lat_var = dataset.createVariable("lat", "f8", ("lat",))
        lat_var.units = "degrees_north"
        lat_var[:] = lat
        lon_var = dataset.createVariable("lon", "f8", ("lon",))
        lon_var.units = "degrees_east"
        lon_var[:] = lon
        data = dataset.createVariable(
            variable,
            "f4",
            ("time", "lat", "lon"),
            zlib=True,
            complevel=4,
            chunksizes=(1, len(lat), len(lon)),
            fill_value=np.float32(np.nan),
        )
        data.units = unit
        count = 0
        for layer in layers:
            data[count] = layer
            count += 1
        if count != len(months):
            raise GridError(f"{path.name}：{len(months)} 個月卻只有 {count} 層")
        dataset.setncatts({"variable": variable, **attrs})
    temp.replace(path)


def write_cube(path: Path, cube: Cube, variable: str) -> None:
    """把記憶體裡的立方體寫成一個壓縮的 NetCDF-4 檔。"""
    write_cube_layers(
        path,
        variable,
        cube.months,
        cube.lat,
        cube.lon,
        cube.unit,
        cube.attrs,
        iter(cube.values),
    )


def read_cube_attrs(path: Path) -> dict[str, str]:
    """只讀立方體的全域屬性（`first_month`、`last_month`、`n_months`…），不載入值。"""
    with netCDF4.Dataset(path) as dataset:
        return {name: str(dataset.getncattr(name)) for name in dataset.ncattrs()}


def read_cube(path: Path) -> Cube:
    """讀 `write_cube` 寫出的立方體。"""
    with netCDF4.Dataset(path) as dataset:
        attrs = {name: str(dataset.getncattr(name)) for name in dataset.ncattrs()}
        var = dataset.variables[attrs["variable"]]
        var.set_auto_mask(False)
        months = [
            EPOCH + timedelta(days=int(days)) for days in dataset.variables["time"][:]
        ]
        return Cube(
            months=months,
            lat=np.asarray(dataset.variables["lat"][:], dtype=np.float64),
            lon=np.asarray(dataset.variables["lon"][:], dtype=np.float64),
            values=np.asarray(var[:], dtype=np.float32),
            unit=str(var.units),
            attrs=attrs,
        )


def cell_edges(centres: Floats, lower: float, upper: float) -> Floats:
    """由等間距的格點中心推出格緣（比中心多一個），並夾在 [lower, upper]。

    MERRA-2 的格點中心落在兩極（±90），夾住之後極區那一列就是半格。
    """
    if len(centres) < 2:
        raise GridError("至少要兩個格點才能推出格緣")
    steps = np.diff(centres)
    step = float(steps[0])
    if step <= 0 or not np.allclose(steps, step, rtol=0, atol=abs(step) * 1e-3):
        raise GridError("格點中心必須等間距且遞增")
    edges = np.concatenate([[centres[0] - step / 2], centres + step / 2])
    return np.clip(edges, lower, upper)


def area_weights(lat: Floats) -> Floats:
    """每一列緯度的相對面積（球面上等經度寬的格子，面積正比於格緣 sin 的差）。"""
    edges = np.sin(np.radians(cell_edges(lat, -90.0, 90.0)))
    return np.diff(edges)


def global_mean(values: Floats, lat: Floats) -> Floats:
    """面積加權平均，對最後兩軸（緯度、經度）取；缺值不計，整張都缺就是 NaN。"""
    weights = np.broadcast_to(area_weights(lat)[:, None], values.shape[-2:])
    valid = np.isfinite(values)
    total = (valid * weights).sum(axis=(-2, -1))
    summed = (np.where(valid, values, 0.0) * weights).sum(axis=(-2, -1))
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(total > 0, summed / total, np.nan)


def regrid(
    values: Floats,
    lat: Floats,
    lon: Floats,
    *,
    lat_step: float,
    lon_factor: int,
    min_valid: float = 0.5,
) -> tuple[Floats, Grid]:
    """面積加權降解析度：緯度從南極起每 `lat_step` 度併成一帶，經度每 `lon_factor` 格併一格。

    緯度用原格子與目標帶的重疊面積當權重（原格子跨兩帶時各算一部分）。
    缺值不計入平均；目標格裡有值的面積比例低於 `min_valid` 時輸出 NaN。
    """
    n_lat, n_lon = values.shape[-2:]
    if (n_lat, n_lon) != (len(lat), len(lon)):
        raise GridError(f"值的形狀 {values.shape} 與座標 ({len(lat)}, {len(lon)}) 不符")
    if lon_factor < 1 or n_lon % lon_factor:
        raise GridError(f"經度格數 {n_lon} 不能被 {lon_factor} 整除")
    source = cell_edges(lat, -90.0, 90.0)
    south = -90.0 + float(np.floor(round((source[0] + 90.0) / lat_step, 6)) * lat_step)
    n_out = int(np.ceil(round((source[-1] - south) / lat_step, 6)))
    target = south + lat_step * np.arange(n_out + 1)
    sin_source, sin_target = np.sin(np.radians(source)), np.sin(np.radians(target))
    overlap = np.minimum(sin_target[1:, None], sin_source[None, 1:]) - np.maximum(
        sin_target[:-1, None], sin_source[None, :-1]
    )
    weights = np.clip(overlap, 0.0, None)

    valid = np.isfinite(values)
    blocks = (*values.shape[:-1], n_lon // lon_factor, lon_factor)
    sums = np.where(valid, values, 0.0).reshape(blocks).sum(axis=-1, dtype=np.float64)
    counts = valid.reshape(blocks).sum(axis=-1, dtype=np.float64)
    numerator = np.einsum("ts,...sl->...tl", weights, sums)
    denominator = np.einsum("ts,...sl->...tl", weights, counts)
    full = weights.sum(axis=1)[:, None] * lon_factor
    with np.errstate(invalid="ignore", divide="ignore"):
        result = np.where(
            (denominator > 0) & (denominator >= min_valid * full - 1e-12),
            numerator / denominator,
            np.nan,
        )
    lon_step = float(lon[1] - lon[0])
    grid = Grid(
        lat_south=south,
        lat_step=lat_step,
        n_lat=n_out,
        lon_west=float(lon[0] - lon_step / 2),
        lon_step=lon_step * lon_factor,
        n_lon=n_lon // lon_factor,
    )
    return result.astype(np.float32), grid


def complete_years(months: list[date]) -> list[int]:
    """12 個月都在的年份（遞增）。"""
    present = {(month.year, month.month) for month in months}
    years = sorted({month.year for month in months})
    return [year for year in years if all((year, m) in present for m in range(1, 13))]


def annual_means(months: list[date], values: Floats) -> tuple[list[int], Floats]:
    """逐年平均（依各月天數加權），只算 12 個月齊全的年份；任一個月缺值該格就是 NaN。"""
    years = complete_years(months)
    index = {(month.year, month.month): i for i, month in enumerate(months)}
    result = np.empty((len(years), *values.shape[1:]), dtype=np.float64)
    for k, year in enumerate(years):
        days = np.array(
            [calendar.monthrange(year, m)[1] for m in range(1, 13)], dtype=np.float64
        )
        rows = values[[index[(year, m)] for m in range(1, 13)]].astype(np.float64)
        result[k] = np.tensordot(days / days.sum(), rows, axes=1)
    return years, result.astype(np.float32)


def monthly_climatology(months: list[date], values: Floats) -> tuple[list[int], Floats]:
    """多年月氣候值：12 層（1 至 12 月），各是齊全年份裡同一個月的平均。回傳 (年份, 值)。"""
    years = complete_years(months)
    if not years:
        raise GridError("沒有 12 個月齊全的年份，算不出月氣候值")
    index = {(month.year, month.month): i for i, month in enumerate(months)}
    result = np.stack(
        [
            values[[index[(year, m)] for year in years]].astype(np.float64).mean(axis=0)
            for m in range(1, 13)
        ]
    )
    return years, result.astype(np.float32)


def _quantize(layers: Layers) -> NDArray[np.int16] | NDArray[np.uint8]:
    if layers.dtype == "uint8":
        return np.asarray(layers.values).astype(np.uint8)
    if layers.dtype != "int16":
        raise GridError(f"{layers.name} 的 dtype 不認得：{layers.dtype}")
    scaled = np.round((layers.values.astype(np.float64) - layers.offset) / layers.scale)
    finite = np.isfinite(scaled)
    if finite.any() and (
        scaled[finite].min() < MISSING + 1 or scaled[finite].max() > 32767
    ):
        raise GridError(
            f"{layers.name} 的值超出 int16 能表示的範圍，請調整 scale 或 offset"
        )
    return np.where(finite, scaled, MISSING).astype("<i2")


def write_frontend(
    directory: Path, info: dict[str, Any], grid: Grid, layer_sets: list[Layers]
) -> list[Path]:
    """寫出前端衍生檔：每組一個 `.i16` 檔，加一份 `meta.json`。回傳寫出的檔案。

    內容相同時重寫不會改變檔案（沒有時間戳），git diff 為空。
    """
    directory.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    entries: list[dict[str, Any]] = []
    for layers in layer_sets:
        expected = (len(layers.labels), grid.n_lat, grid.n_lon)
        if layers.values.shape != expected:
            raise GridError(
                f"{layers.name} 的形狀 {layers.values.shape} 應為 {expected}"
            )
        suffix = ".u8" if layers.dtype == "uint8" else ".i16"
        path = directory / f"{layers.name}{suffix}"
        path.write_bytes(_quantize(layers).tobytes())
        written.append(path)
        entries.append(
            {
                "name": layers.name,
                "file": path.name,
                "description": layers.description,
                "unit": layers.unit,
                "scale": layers.scale,
                "offset": layers.offset,
                "n_layers": len(layers.labels),
                "labels": layers.labels,
                "bytes": path.stat().st_size,
            }
        )
        if layers.dtype == "uint8":
            entries[-1].update(dtype="uint8", missing=0, classes=layers.classes or {})
    meta = {
        **info,
        "grid": {
            "n_lat": grid.n_lat,
            "n_lon": grid.n_lon,
            "lat_south_edge": grid.lat_south,
            "lat_step": grid.lat_step,
            "lon_west_edge": grid.lon_west,
            "lon_step": grid.lon_step,
            "order": "layer, lat (south to north), lon (west to east); row-major",
            "cell_centre": "lat = lat_south_edge + (i + 0.5) * lat_step; "
            "lon = lon_west_edge + (j + 0.5) * lon_step",
        },
        "encoding": {
            "dtype": "int16",
            "byte_order": "little",
            "missing": MISSING,
            "decode": "value = stored * scale + offset",
        },
        "layers": entries,
    }
    meta_path = directory / META_FILE
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    return [*written, meta_path]


def read_frontend(directory: Path) -> tuple[dict[str, Any], dict[str, Floats]]:
    """讀回前端衍生檔：回傳 (meta, {名稱: (層, 緯度, 經度) 的 float32，缺值為 NaN})。

    類別圖層（`dtype: "uint8"`）照類別代碼回傳，0 是缺值，不轉成 NaN。
    """
    meta = json.loads((directory / META_FILE).read_text(encoding="utf-8"))
    shape = (meta["grid"]["n_lat"], meta["grid"]["n_lon"])
    arrays: dict[str, Floats] = {}
    for entry in meta["layers"]:
        raw = (directory / entry["file"]).read_bytes()
        if entry.get("dtype") == "uint8":
            classes = np.frombuffer(raw, dtype=np.uint8)
            arrays[entry["name"]] = classes.reshape((entry["n_layers"], *shape)).astype(
                np.float32
            )
            continue
        stored = np.frombuffer(raw, dtype="<i2")
        stored = stored.reshape((entry["n_layers"], *shape))
        decoded = stored.astype(np.float64) * entry["scale"] + entry["offset"]
        arrays[entry["name"]] = np.where(stored == MISSING, np.nan, decoded).astype(
            np.float32
        )
    return meta, arrays
