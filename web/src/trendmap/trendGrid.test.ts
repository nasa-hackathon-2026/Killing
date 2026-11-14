import { SphereGeometry } from "three";
import { describe, expect, it } from "vitest";
import { latLonToVector3 } from "../geo/latLon";
import { loadTrendMap } from "./loadTrendMap";
import {
  cellIndex,
  decodeSignificance,
  decodeSlopes,
  divergingColor,
  formatSlope,
  gridSpherePatch,
  paintTrendMap,
  significanceAlpha,
  slopeUnitLabel,
  symmetricLimit,
  trendGridSpec,
  type TrendGridMeta,
} from "./trendGrid";
import {
  NOT_SIGNIFICANT_ALPHA,
  PALETTES,
  TREND_MAP_VARIABLES,
} from "./trendMapConfig";

// Same shape as data/grid/<id>/meta.json, on a 2 × 3 grid.
function meta(grid: Partial<TrendGridMeta["grid"]> = {}): TrendGridMeta {
  return {
    id: "gldas_tair",
    name_en: "Test",
    product: "TEST.1",
    grid: {
      n_lat: 2,
      n_lon: 3,
      lat_south_edge: -60,
      lat_step: 1,
      lon_west_edge: -180,
      lon_step: 1,
      order: "layer, lat (south to north), lon (west to east); row-major",
      ...grid,
    },
    encoding: { dtype: "int16", byte_order: "little", missing: -32768 },
    trend: {
      parameters: { alpha: 0.05 },
      period: { first_month: "2000-01", last_month: "2026-07", n_months: 319 },
      cells: { n_total: 6, n_analyzed: 5 },
      significant: {
        uncorrected: { area_fraction: 0.6 },
        fdr: { area_fraction: 0.5 },
      },
    },
    layers: [
      {
        name: "trend_slope_per_decade",
        file: "trend_slope_per_decade.i16",
        unit: "K per decade",
        scale: 0.001,
        offset: 0,
      },
      {
        name: "trend_significance",
        file: "trend_significance.u8",
        unit: "class",
        scale: 1,
        offset: 0,
        dtype: "uint8",
        missing: 0,
        classes: { "0": "a", "1": "b", "2": "c", "3": "d" },
      },
    ],
  };
}

function int16Bytes(values: number[]): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(values.length * 2));
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return view.buffer;
}

describe("trendGridSpec", () => {
  it("reads the grid and the two trend layers", () => {
    const spec = trendGridSpec(meta());
    expect(spec).toMatchObject({ nLat: 2, nLon: 3, latSouth: -60 });
    expect(spec.slope).toMatchObject({ scale: 0.001, missing: -32768 });
    expect(spec.significance.file).toBe("trend_significance.u8");
  });

  it("refuses a layout it does not know", () => {
    expect(() =>
      trendGridSpec(meta({ order: "layer, lat (north to south), lon" })),
    ).toThrow(/order/);
    const bigEndian = meta();
    bigEndian.encoding.byte_order = "big";
    expect(() => trendGridSpec(bigEndian)).toThrow(/encoding/);
    const noTrend = meta();
    noTrend.layers = [];
    expect(() => trendGridSpec(noTrend)).toThrow(/trend layers/);
  });
});

describe("decoding", () => {
  const spec = trendGridSpec(meta());

  it("applies scale and offset to little-endian int16, NaN for missing", () => {
    const slopes = decodeSlopes(
      int16Bytes([1500, -250, -32768, 0, 32767, -32767]),
      spec,
    );
    expect(slopes[0]).toBeCloseTo(1.5);
    expect(slopes[1]).toBeCloseTo(-0.25);
    expect(slopes[2]).toBeNaN();
    expect(slopes[3]).toBe(0);
    expect(slopes[4]).toBeCloseTo(32.767);
  });

  it("refuses files of the wrong size", () => {
    expect(() => decodeSlopes(int16Bytes([1, 2]), spec)).toThrow(/bytes/);
    expect(() => decodeSignificance(new ArrayBuffer(5), spec)).toThrow(/bytes/);
    expect(
      decodeSignificance(new Uint8Array([0, 1, 2, 3, 3, 1]).buffer, spec),
    ).toHaveLength(6);
  });
});

describe("symmetricLimit", () => {
  it("takes a high quantile of the absolute slopes, ignoring missing", () => {
    const slopes = new Float32Array(101);
    for (let index = 0; index < 100; index += 1) {
      slopes[index] = index % 2 === 0 ? index + 1 : -(index + 1);
    }
    slopes[100] = Number.NaN;
    expect(symmetricLimit(slopes, 0.98)).toBe(98);
    expect(symmetricLimit(slopes, 1)).toBe(100);
  });

  it("rounds to two significant digits and never returns 0", () => {
    expect(symmetricLimit(new Float32Array([1.7906]), 0.98)).toBe(1.8);
    expect(symmetricLimit(new Float32Array([0, 0]), 0.98)).toBe(1);
    expect(symmetricLimit(new Float32Array([Number.NaN]), 0.98)).toBe(1);
  });
});

describe("colour", () => {
  const palette = PALETTES["blue-red"];

  it("maps falling, zero and rising to the ends and middle of the ramp", () => {
    expect(divergingColor(-2, 2, palette)).toEqual(palette[0]);
    expect(divergingColor(0, 2, palette)).toEqual(palette[3]);
    expect(divergingColor(2, 2, palette)).toEqual(palette[6]);
    expect(divergingColor(99, 2, palette)).toEqual(palette[6]);
    expect(divergingColor(-99, 2, palette)).toEqual(palette[0]);
  });

  it("uses a different hue for each direction in every palette", () => {
    for (const stops of Object.values(PALETTES)) {
      const [fallRed, , fallBlue] = divergingColor(-1, 1, stops);
      const [riseRed, , riseBlue] = divergingColor(1, 1, stops);
      expect(Math.sign(fallRed - fallBlue)).not.toBe(
        Math.sign(riseRed - riseBlue),
      );
    }
  });

  it("fades what is not significant after correction and hides missing", () => {
    expect(significanceAlpha(3)).toBe(1);
    expect(significanceAlpha(2)).toBe(NOT_SIGNIFICANT_ALPHA);
    expect(significanceAlpha(1)).toBe(NOT_SIGNIFICANT_ALPHA);
    expect(significanceAlpha(0)).toBe(0);
    expect(NOT_SIGNIFICANT_ALPHA).toBeLessThan(0.5);
  });

  it("paints one RGBA pixel per cell in file order", () => {
    const slopes = new Float32Array([2, -2, Number.NaN, 0]);
    const pixels = paintTrendMap(
      slopes,
      new Uint8Array([3, 1, 0, 2]),
      2,
      palette,
    );
    expect([...pixels.slice(0, 4)]).toEqual([...palette[6], 255]);
    expect([...pixels.slice(4, 8)]).toEqual([
      ...palette[0],
      Math.round(NOT_SIGNIFICANT_ALPHA * 255),
    ]);
    expect([...pixels.slice(8, 12)]).toEqual([0, 0, 0, 0]);
    expect(pixels[15]).toBe(Math.round(NOT_SIGNIFICANT_ALPHA * 255));
  });
});

describe("placement on the globe", () => {
  // The grids in data/grid: GLDAS (60°S to 90°N), AIRS/IMERG (global) and
  // MERRA-2 (1.25° columns that start half a native cell west of -180).
  const grids = [
    { n_lat: 150, n_lon: 360, lat_south_edge: -60, lon_west_edge: -180 },
    { n_lat: 180, n_lon: 360, lat_south_edge: -90, lon_west_edge: -180 },
    {
      n_lat: 180,
      n_lon: 288,
      lat_south_edge: -90,
      lon_west_edge: -180.3125,
      lon_step: 1.25,
    },
  ];

  it("puts every UV of the patch where latLonToVector3 puts that point", () => {
    for (const grid of grids) {
      const spec = trendGridSpec(meta(grid));
      const patch = gridSpherePatch(spec);
      const geometry = new SphereGeometry(
        1,
        24,
        12,
        patch.phiStart,
        patch.phiLength,
        patch.thetaStart,
        patch.thetaLength,
      );
      const position = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      for (let index = 0; index < position.count; index += 1) {
        // u runs west to east and v south to north across the grid edges.
        const lon = spec.lonWest + uv.getX(index) * spec.nLon * spec.lonStep;
        const lat = spec.latSouth + uv.getY(index) * spec.nLat * spec.latStep;
        const expected = latLonToVector3(lat, lon);
        expect(position.getX(index)).toBeCloseTo(expected.x, 5);
        expect(position.getY(index)).toBeCloseTo(expected.y, 5);
        expect(position.getZ(index)).toBeCloseTo(expected.z, 5);
      }
    }
  });

  it("finds the cell that contains a point", () => {
    const gldas = trendGridSpec(meta(grids[0]));
    expect(cellIndex(gldas, -59.5, -179.5)).toBe(0);
    expect(cellIndex(gldas, -60, -180)).toBe(0);
    expect(cellIndex(gldas, 24.2, 120.7)).toBe(84 * 360 + 300);
    expect(cellIndex(gldas, -75, 0)).toBeNull();
    const merra = trendGridSpec(meta(grids[2]));
    expect(cellIndex(merra, -89.5, -180)).toBe(0);
    // 179.9°E is in the first column, which straddles the date line.
    expect(cellIndex(merra, -89.5, 179.9)).toBe(0);
    expect(cellIndex(merra, -89.5, 0)).toBe(144);
  });
});

describe("labels", () => {
  it("shows K differences as °C and drops 'per decade'", () => {
    expect(slopeUnitLabel("K per decade")).toBe("°C");
    expect(slopeUnitLabel("kg m-2 per decade")).toBe("kg m-2");
  });

  it("formats range ends with two significant digits", () => {
    expect(formatSlope(1.8)).toBe("1.8");
    expect(formatSlope(0.025)).toBe("0.025");
    expect(formatSlope(3.2e-6)).toBe("3.2e-6");
    expect(formatSlope(0)).toBe("0");
  });
});

describe("loadTrendMap", () => {
  it("fetches meta.json, then the two files it names, and paints them", async () => {
    const asked: string[] = [];
    const map = await loadTrendMap(
      "gldas_tair",
      {
        json: async (url) => {
          asked.push(url);
          return meta();
        },
        bytes: async (url) => {
          asked.push(url);
          return url.endsWith(".i16")
            ? int16Bytes([1000, -1000, -32768, 500, 0, 2000])
            : new Uint8Array([3, 3, 0, 1, 2, 3]).buffer;
        },
      },
      (id, file) => `grid/${id}/${file}`,
    );
    expect(asked).toEqual([
      "grid/gldas_tair/meta.json",
      "grid/gldas_tair/trend_slope_per_decade.i16",
      "grid/gldas_tair/trend_significance.u8",
    ]);
    expect(map.limit).toBe(2);
    expect(map.pixels).toHaveLength(6 * 4);
    expect(map.pixels[11]).toBe(0);
    expect(map.pixels[23]).toBe(255);
  });

  it("only knows the configured variables", async () => {
    expect(TREND_MAP_VARIABLES).toHaveLength(7);
    await expect(loadTrendMap("omi_no2")).rejects.toThrow(/no trend map/);
  });
});
