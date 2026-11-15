import { describe, expect, it } from "vitest";
import {
  CITY_IMAGES,
  TAIWAN_DETAIL,
  WORLD_CITIES,
  contains,
  detailCovers,
  detailImageAt,
  detailOpacity,
  gibsTile,
  shouldLoadDetail,
} from "./detailCoverage";

describe("Taiwan detail coverage", () => {
  it("stays within the tile limit and covers the five markers", () => {
    expect(TAIWAN_DETAIL.tileCount).toBeLessThanOrEqual(
      TAIWAN_DETAIL.tileLimit,
    );
    expect(detailCovers(24.15, 120.68)).toBe(true);
    expect(detailCovers(25.03, 121.56)).toBe(true);
    expect(detailCovers(22.63, 120.3)).toBe(true);
    expect(detailCovers(23.99, 121.6)).toBe(true);
    expect(detailCovers(23.47, 120.95)).toBe(true);
    expect(detailCovers(35, 139)).toBe(false);
  });

  it("fades in only as the camera comes close", () => {
    expect(detailOpacity(3.2)).toBe(0);
    expect(detailOpacity(1.85)).toBe(0);
    expect(detailOpacity(1.6)).toBe(0);
    expect(detailOpacity(1.28)).toBe(1);
    expect(detailOpacity(1.18)).toBe(1);
    const mid = detailOpacity(1.44);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(detailOpacity(1.5)).toBeLessThan(mid);
  });
});

describe("world city tiles", () => {
  it("keeps each world city inside its own single tile", () => {
    expect(WORLD_CITIES.map((city) => city.id)).toEqual([
      "tokyo",
      "delhi",
      "beijing",
      "jakarta",
      "cairo",
      "lagos",
      "london",
      "moscow",
      "new_york",
      "los_angeles",
      "sao_paulo",
      "sydney",
    ]);
    for (const city of WORLD_CITIES) {
      const tile = gibsTile(city.lat, city.lon);
      expect(tile.east - tile.west).toBeCloseTo(2.25);
      expect(tile.north - tile.south).toBeCloseTo(2.25);
      expect(contains(tile, city.lat, city.lon)).toBe(true);
      const image = detailImageAt(city.lat, city.lon);
      expect(image?.id).toBe(city.id);
      expect(image?.file).toContain(`/${tile.row}/${tile.col}.jpg`);
    }
    expect(CITY_IMAGES).toHaveLength(12);
  });

  it("keeps Taiwan on its stitched image and leaves empty ocean on the globe", () => {
    expect(detailImageAt(24.15, 120.68)?.file).toBe(
      "textures/taiwan-detail.png",
    );
    expect(detailImageAt(0, 0)).toBeNull();
  });

  it("loads a tile only when the camera is close and over it", () => {
    expect(shouldLoadDetail(3, true)).toBe(false);
    expect(shouldLoadDetail(1.5, false)).toBe(false);
    expect(shouldLoadDetail(1.5, true)).toBe(true);
    expect(shouldLoadDetail(1.7, true)).toBe(false);
  });
});
