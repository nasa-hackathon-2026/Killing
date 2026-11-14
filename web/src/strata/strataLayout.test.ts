import { describe, expect, it } from "vitest";
import {
  companionSpot,
  LAYER_GAP,
  layoutStrata,
  particleRange,
  PLATFORM_DEPTH,
  PLATFORM_WIDTH,
  SLAB_HEIGHT,
  stackExtent,
} from "./strataLayout";
import { strata, strataAssignment } from "./strataSpec";

describe("layoutStrata", () => {
  it("orders the platforms top first and spaces them evenly when pulled apart", () => {
    const boxes = layoutStrata(1);
    expect(boxes.map((box) => box.id)).toEqual(strata.map((item) => item.id));
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index - 1].y - boxes[index].y).toBeCloseTo(LAYER_GAP);
    }
    for (const box of boxes) expect(box.top - box.y).toBeCloseTo(SLAB_HEIGHT);
  });

  it("keeps slabs from overlapping and centers the stack", () => {
    const boxes = layoutStrata(1);
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index].top).toBeLessThan(boxes[index - 1].y);
    }
    expect(boxes[0].y + boxes[boxes.length - 1].y).toBeCloseTo(0);
  });

  it("presses the stack together at spread 0 without making it flat", () => {
    const extent = stackExtent(layoutStrata(0));
    const full = stackExtent(layoutStrata(1));
    expect(extent.top - extent.bottom).toBeGreaterThan(0);
    expect(extent.top - extent.bottom).toBeLessThan(
      0.05 * (full.top - full.bottom),
    );
    expect(layoutStrata(-3)).toEqual(layoutStrata(0));
    expect(layoutStrata(9)).toEqual(layoutStrata(1));
  });
});

describe("particleRange", () => {
  const boxes = layoutStrata(1);
  const box = (id: string) => boxes.find((item) => item.id === id)!;

  it("keeps a variable inside its own slab", () => {
    const range = particleRange(strataAssignment("omi_o3")!, boxes)!;
    expect(range).toEqual({
      from: box("stratosphere").y,
      to: box("stratosphere").top,
      crosses: false,
    });
  });

  it("lets rain fall from its slab to the land surface", () => {
    const range = particleRange(strataAssignment("imerg_precip")!, boxes)!;
    expect(range.crosses).toBe(true);
    expect(range.from).toBe(box("troposphere-water").top);
    expect(range.to).toBe(box("land-surface").y);
    expect(range.from).toBeGreaterThan(range.to);
  });

  it("lets evapotranspiration rise from the land surface into the near-surface air", () => {
    const range = particleRange(strataAssignment("gldas_evap")!, boxes)!;
    expect(range.from).toBe(box("land-surface").y);
    expect(range.to).toBe(box("near-surface").top);
    expect(range.to).toBeGreaterThan(range.from);
  });

  it("returns null for a stratum that is not laid out", () => {
    expect(particleRange(strataAssignment("omi_o3")!, [])).toBeNull();
  });
});

describe("companionSpot", () => {
  it("keeps companions on the platform and apart from each other", () => {
    const spots = [0, 1, 2].map((index) => companionSpot(index, 3));
    for (const [x, z] of spots) {
      expect(Math.abs(x)).toBeLessThan(PLATFORM_WIDTH / 2);
      expect(Math.abs(z)).toBeLessThan(PLATFORM_DEPTH / 2);
    }
    expect(spots[1][0] - spots[0][0]).toBeGreaterThan(0.5);
    expect(companionSpot(0, 1)[0]).toBeCloseTo(0);
  });
});
