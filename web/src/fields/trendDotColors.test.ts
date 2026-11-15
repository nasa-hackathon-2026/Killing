import { describe, expect, it } from "vitest";
import type { TrendMap } from "../trendmap/loadTrendMap";
import type { FieldData } from "./loadField";
import { trendDotColors } from "./trendDotColors";

const grid = {
  nLat: 1,
  nLon: 2,
  latSouth: -90,
  latStep: 180,
  lonWest: -180,
  lonStep: 180,
};

function map(over: Partial<typeof grid> = {}): TrendMap {
  return {
    spec: { ...grid, ...over },
    // Cell 0: red, full strength; cell 1: blue, faded.
    pixels: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 51),
  } as unknown as TrendMap;
}

const field = {
  spec: grid,
  dots: { count: 2, cell: Int32Array.of(1, 0) },
} as unknown as FieldData;

describe("trendDotColors", () => {
  it("gives each dot the colour and strength of its cell", () => {
    const colors = trendDotColors(map(), field);
    const expected = [0, 0, 1, 51 / 255, 1, 0, 0, 1];
    expect(colors).not.toBeNull();
    expected.forEach((value, index) =>
      expect(colors?.[index]).toBeCloseTo(value, 5),
    );
  });

  it("is null when there is no trend map or the grids differ", () => {
    expect(trendDotColors(null, field)).toBeNull();
    expect(trendDotColors(map({ lonStep: 90 }), field)).toBeNull();
  });
});
