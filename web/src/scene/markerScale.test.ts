import { describe, expect, it } from "vitest";
import { markerScale } from "./markerScale";

describe("markerScale", () => {
  it("is smaller on screen as the camera comes closer", () => {
    const far = markerScale(3.2);
    const framed = markerScale(2.05);
    const close = markerScale(1.3);
    expect(far).toBeCloseTo(1);
    expect(framed).toBeLessThan(far);
    expect(close).toBeLessThan(framed);
    // A constant screen size would be height / 2.2. Close in, we are below that.
    expect(close).toBeLessThan((1.3 - 1) / (3.2 - 1));
  });
});
