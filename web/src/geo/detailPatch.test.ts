import { describe, expect, it } from "vitest";
import { taiwanPatch } from "./detailPatch";

describe("taiwanPatch", () => {
  it("faces outward and maps the north edge to the top of the image", () => {
    const patch = taiwanPatch(1.004, 4, 4);
    const ax = patch.positions[0] ?? 0;
    const ay = patch.positions[1] ?? 0;
    const az = patch.positions[2] ?? 0;
    const bx = patch.positions[3] ?? 0;
    const by = patch.positions[4] ?? 0;
    const bz = patch.positions[5] ?? 0;
    const south = (4 + 1) * 3;
    const cx = patch.positions[south] ?? 0;
    const cy = patch.positions[south + 1] ?? 0;
    const cz = patch.positions[south + 2] ?? 0;
    const eastX = bx - ax;
    const eastY = by - ay;
    const eastZ = bz - az;
    const southX = cx - ax;
    const southY = cy - ay;
    const southZ = cz - az;
    const nx = southY * eastZ - southZ * eastY;
    const ny = southZ * eastX - southX * eastZ;
    const nz = southX * eastY - southY * eastX;
    expect(nx * ax + ny * ay + nz * az).toBeGreaterThan(0);
    expect(patch.uvs[1]).toBeCloseTo(1);
    expect(patch.uvs[0]).toBeCloseTo(0);
  });
});
