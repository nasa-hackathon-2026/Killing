import { describe, expect, it } from "vitest";
import {
  fieldGridSpec,
  decodeClimatology,
  placeDots,
  climatologyRange,
  type FieldGridMeta,
} from "./fieldGrid";
import { loadField } from "./loadField";
import { parseFieldParam, resolveField } from "./fieldStore";

const meta: FieldGridMeta = {
  id: "gldas_tair",
  name_en: "Air temperature",
  product: "TEST",
  grid: {
    n_lat: 2,
    n_lon: 2,
    lat_south_edge: -90,
    lat_step: 90,
    lon_west_edge: -180,
    lon_step: 180,
    order: "layer, lat (south to north), lon (west to east); row-major",
  },
  encoding: { dtype: "int16", byte_order: "little", missing: -32768 },
  coverage: { complete_years: [2001, 2025] },
  layers: [
    {
      name: "monthly_climatology",
      file: "monthly_climatology.i16",
      unit: "K",
      scale: 0.5,
      offset: 250,
      labels: Array.from({ length: 12 }, (_, index) =>
        String(index + 1).padStart(2, "0"),
      ),
    },
  ],
};

function bytes(): ArrayBuffer {
  const view = new DataView(new ArrayBuffer(96));
  for (let month = 0; month < 12; month += 1) {
    [month, 20, -32768, 60].forEach((value, cell) =>
      view.setInt16((month * 4 + cell) * 2, value, true),
    );
  }
  return view.buffer;
}

describe("global distribution grid", () => {
  it("decodes little-endian months in south-to-north row order", () => {
    const spec = fieldGridSpec(meta);
    const months = decodeClimatology(bytes(), spec);
    expect(spec.climatology.period).toEqual([2001, 2025]);
    expect(Array.from(months[0])).toEqual([250, 260, Number.NaN, 280]);
    expect(months[11][0]).toBe(255.5);
    expect(() => decodeClimatology(new ArrayBuffer(2), spec)).toThrow();
  });

  it("rejects swapped or incomplete monthly labels", () => {
    expect(() =>
      fieldGridSpec({
        ...meta,
        layers: [{ ...meta.layers[0], labels: ["12", "01"] }],
      }),
    ).toThrow();
  });

  it("keeps deterministic geographic positions and excludes missing cells", () => {
    const spec = fieldGridSpec(meta);
    const months = decodeClimatology(bytes(), spec);
    const range = climatologyRange(months)!;
    const dots = placeDots(spec, months, range, 1, 200, 12);
    expect(dots).toEqual(placeDots(spec, months, range, 1, 200, 12));
    expect(dots.count).toBe(200);
    for (let index = 0; index < dots.count; index += 1) {
      const cell = dots.cell[index];
      expect(cell).not.toBe(2);
      expect(dots.lat[index] >= 0).toBe(cell >= 2);
      expect(dots.lon[index] >= 0).toBe(cell % 2 === 1);
    }
  });

  it("loads only the selected variable metadata and climatology", async () => {
    const requested: string[] = [];
    const field = await loadField(
      "gldas_tair",
      20,
      {
        json: async (url) => {
          requested.push(url);
          return meta;
        },
        bytes: async (url) => {
          requested.push(url);
          return bytes();
        },
      },
      (id, file) => `${id}/${file}`,
    );
    expect(requested).toEqual([
      "gldas_tair/meta.json",
      "gldas_tair/monthly_climatology.i16",
    ]);
    expect(field.dots.count).toBe(20);
    await expect(loadField("unknown", 20)).rejects.toThrow();
  });

  it("defaults to off and resolves only supported URL and auto selections", () => {
    expect(parseFieldParam(null)).toBeNull();
    expect(parseFieldParam("unknown")).toBeNull();
    expect(parseFieldParam("imerg_precip")).toBe("imerg_precip");
    expect(resolveField("auto", "gldas_tair", ["imerg_precip"])).toBe(
      "gldas_tair",
    );
    expect(resolveField("auto", "unknown", ["imerg_precip"])).toBe(
      "imerg_precip",
    );
    expect(resolveField(null, "gldas_tair", [])).toBeNull();
  });
});
