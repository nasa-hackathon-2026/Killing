import { describe, expect, it } from "vitest";
import { TAIWAN_DETAIL, detailCovers, detailOpacity } from "./detailCoverage";

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
