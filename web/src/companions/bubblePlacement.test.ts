import { describe, expect, it } from "vitest";
import { placeBubble } from "./bubblePlacement";

const viewport = { width: 1440, height: 900 };
const size = { width: 272, height: 140 };
// A companion in the sidebar at the right edge.
const pet = { left: 1150, top: 500, width: 52, height: 52 };

describe("placeBubble", () => {
  it("goes to the left of a companion at the right edge, level with it", () => {
    const place = placeBubble(pet, size, viewport);
    expect(place.side).toBe("left");
    expect(place.left).toBe(1150 - 12 - 272);
    // Centred on the companion: 526 - 70.
    expect(place.top).toBe(456);
    expect(place.tail).toBe(70);
  });

  it("stays inside the window and keeps the tail on the companion", () => {
    const high = placeBubble({ ...pet, top: 20 }, size, viewport);
    expect(high.top).toBe(12);
    // The companion centre is at 46: 34 below the bubble top.
    expect(high.tail).toBe(34);
    const low = placeBubble({ ...pet, top: 880 }, size, viewport);
    expect(low.top + size.height).toBe(900 - 12);
  });

  it("goes to the right when there is no room on the left", () => {
    const place = placeBubble({ ...pet, left: 100 }, size, viewport);
    expect(place.side).toBe("right");
    expect(place.left).toBe(100 + 52 + 12);
  });

  it("goes above, then below, on a window too narrow for either side", () => {
    const phone = { width: 390, height: 844 };
    const above = placeBubble(
      { left: 150, top: 500, width: 52, height: 52 },
      size,
      phone,
    );
    expect(above.side).toBe("top");
    expect(above.top).toBe(500 - 12 - 140);
    expect(above.left).toBeGreaterThanOrEqual(12);
    expect(above.left + size.width).toBeLessThanOrEqual(390 - 12);
    const below = placeBubble(
      { left: 150, top: 60, width: 52, height: 52 },
      size,
      phone,
    );
    expect(below.side).toBe("bottom");
  });

  it("never puts the tail past the corners", () => {
    const place = placeBubble({ ...pet, top: 66, height: 4 }, size, viewport);
    expect(place.tail).toBeGreaterThanOrEqual(18);
    expect(place.tail).toBeLessThanOrEqual(size.height - 18);
  });
});
