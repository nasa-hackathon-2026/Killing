import { describe, expect, it } from "vitest";
import { CAMERA_FOV, MEDIUM_SHIFT_PX, startLongitudeShift } from "./startView";

const DEG = Math.PI / 180;

// Pixels left of the middle at which a place on the equator is drawn when
// the camera is `shift` degrees east of it.
function offsetPx(shift: number, height: number, distance: number): number {
  const focal = height / 2 / Math.tan((CAMERA_FOV / 2) * DEG);
  return (focal * Math.sin(shift * DEG)) / (distance - Math.cos(shift * DEG));
}

describe("startLongitudeShift", () => {
  it("keeps the camera straight over the place on wide windows and phones", () => {
    expect(startLongitudeShift(1400, 900, 3.2, 24)).toBe(0);
    expect(startLongitudeShift(1280, 720, 3.2, 24)).toBe(0);
    expect(startLongitudeShift(390, 844, 3.2, 24)).toBe(0);
  });

  it("puts the place left of the right-hand panels on medium windows", () => {
    const shift = startLongitudeShift(1024, 768, 3.2, 0);
    expect(shift).toBeGreaterThan(5);
    expect(shift).toBeLessThan(30);
    // The marker lands between the start card and the Companions panel.
    const x = 512 - offsetPx(shift, 768, 3.2);
    expect(x).toBeCloseTo(512 - MEDIUM_SHIFT_PX, 0);
    expect(x).toBeGreaterThan(400);
    expect(x).toBeLessThan(1024 - 514 - 60);
  });

  it("turns further at higher latitudes for the same shift on screen", () => {
    expect(startLongitudeShift(1024, 768, 3.2, 60)).toBeGreaterThan(
      startLongitudeShift(1024, 768, 3.2, 0),
    );
  });
});
