import { describe, expect, it } from "vitest";
import {
  approachPosition,
  clampDepression,
  clampZoom,
  DEFAULT_DEPRESSION,
  ENTRY_DEPRESSION,
  ENTRY_DISTANCE,
  entryPose,
  entrySpread,
  CHART_COLUMN,
  CREDIT_RESERVE,
  fitDistance,
  HUD_RESERVE,
  insetView,
  LABEL_COLUMN,
  labelCeiling,
  MEDIUM_WIDTH,
  PANEL_COLUMN,
  MAX_DEPRESSION,
  MIN_DEPRESSION,
  MIN_ZOOM,
  NARROW_WIDTH,
  posePosition,
  TIMELINE_RESERVE,
  viewInsets,
  zoomTargetY,
  type OrbitPose,
  type Vec3,
} from "./strataCamera";

const final: OrbitPose = {
  azimuth: -0.5,
  depression: DEFAULT_DEPRESSION,
  distance: 10,
  targetY: 0.4,
};

describe("orbit limits", () => {
  it("keeps the view oblique", () => {
    expect(clampDepression(0)).toBe(MIN_DEPRESSION);
    expect(clampDepression(Math.PI / 2)).toBe(MAX_DEPRESSION);
    expect(clampDepression(Number.NaN)).toBe(MIN_DEPRESSION);
    expect(MIN_DEPRESSION).toBeGreaterThan(0.4);
    expect(MAX_DEPRESSION).toBeLessThan(1.2);
    expect(DEFAULT_DEPRESSION).toBeGreaterThan(MIN_DEPRESSION);
    expect(DEFAULT_DEPRESSION).toBeLessThan(MAX_DEPRESSION);
  });

  it("limits zoom", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(50)).toBeLessThan(1.5);
  });
});

describe("posePosition", () => {
  it("sits at the given distance, above the target", () => {
    const [x, y, z] = posePosition(final);
    expect(Math.hypot(x, y - final.targetY, z)).toBeCloseTo(final.distance);
    expect(y - final.targetY).toBeCloseTo(
      final.distance * Math.sin(final.depression),
    );
  });

  it("turns about the vertical axis with azimuth", () => {
    const front = posePosition({ ...final, azimuth: 0 });
    expect(front[0]).toBeCloseTo(0);
    expect(front[2]).toBeGreaterThan(0);
    const side = posePosition({ ...final, azimuth: Math.PI / 2 });
    expect(side[2]).toBeCloseTo(0);
    expect(side[1]).toBeCloseTo(front[1]);
  });
});

describe("entry path", () => {
  it("starts almost straight down at the ground and ends at the user's pose", () => {
    expect(entryPose(0, final)).toEqual({
      azimuth: 0,
      depression: ENTRY_DEPRESSION,
      distance: ENTRY_DISTANCE,
      targetY: 0,
    });
    const end = entryPose(1, final);
    expect(end.azimuth).toBeCloseTo(final.azimuth);
    expect(end.depression).toBeCloseTo(final.depression);
    expect(end.distance).toBeCloseTo(final.distance);
    expect(end.targetY).toBeCloseTo(final.targetY);
  });

  it("tilts and backs away monotonically", () => {
    let last = entryPose(0, final);
    for (let step = 1; step <= 20; step += 1) {
      const pose = entryPose(step / 20, final);
      expect(pose.depression).toBeLessThanOrEqual(last.depression + 1e-12);
      expect(pose.distance).toBeGreaterThanOrEqual(last.distance - 1e-12);
      last = pose;
    }
  });

  it("pulls the strata apart from 0 to 1 without going back", () => {
    expect(entrySpread(0)).toBe(0);
    expect(entrySpread(1)).toBe(1);
    let last = 0;
    for (let step = 1; step <= 20; step += 1) {
      const spread = entrySpread(step / 20);
      expect(spread).toBeGreaterThanOrEqual(last);
      last = spread;
    }
  });
});

describe("fitDistance and insets", () => {
  it("moves the camera back for a narrow viewport", () => {
    expect(fitDistance(0.4)).toBeGreaterThan(fitDistance(1.6));
    expect(fitDistance(1.6)).toBe(fitDistance(3));
    expect(Number.isFinite(fitDistance(0))).toBe(true);
  });

  it("reserves the HUD row, both side columns and the timeline bar on a wide screen", () => {
    const wide = viewInsets(1400, 900);
    expect(wide.top).toBe(HUD_RESERVE);
    expect(wide.bottom).toBe(TIMELINE_RESERVE);
    expect(wide.left).toBe(LABEL_COLUMN);
    expect(wide.right).toBe(PANEL_COLUMN);
    // The free area is wider than the stack needs, so the stack is limited
    // by height and sits in the middle of that area.
    expect(1400 - wide.left - wide.right).toBeGreaterThan(600);
    const narrow = viewInsets(NARROW_WIDTH - 1, 844);
    expect(narrow.left).toBeGreaterThan(0);
    expect(narrow.bottom).toBeGreaterThan(narrow.top);
    expect(viewInsets(0, 0)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("makes room for the chart beside the Layers panel only on a wide screen", () => {
    expect(viewInsets(1400, 900, true).right).toBe(PANEL_COLUMN + CHART_COLUMN);
    // Medium widths: the chart takes the place of the Layers panel.
    expect(viewInsets(MEDIUM_WIDTH, 768, true)).toEqual(
      viewInsets(MEDIUM_WIDTH, 768),
    );
    for (const width of [1181, 1280, 1400]) {
      const insets = viewInsets(width, 720, true);
      expect(width - insets.left - insets.right).toBeGreaterThan(150);
    }
  });

  it("stops the label column above the credit, or above the timeline bar where the bar is under it", () => {
    expect(labelCeiling(1400, 900)).toBe(900 - CREDIT_RESERVE);
    expect(labelCeiling(1024, 768)).toBe(768 - TIMELINE_RESERVE);
    expect(labelCeiling(390, 844)).toBeLessThan(844 - TIMELINE_RESERVE);
  });

  it("centers the picture in the free area", () => {
    const view = insetView(1000, 800, {
      top: 200,
      right: 0,
      bottom: 0,
      left: 100,
    });
    expect(view.offsetX).toBe(50);
    expect(view.offsetY).toBe(100);
    expect(view.aspect).toBeCloseTo(900 / 600);
    expect(view.scale).toBeCloseTo(800 / 600);
  });
});

describe("zoomTargetY", () => {
  it("looks at the middle when zoomed out and under the pointer when zoomed in", () => {
    expect(zoomTargetY(1, 0, -3, 3)).toBeCloseTo(0);
    expect(zoomTargetY(MIN_ZOOM, 0, -3, 3)).toBeCloseTo(3);
    expect(zoomTargetY(MIN_ZOOM, 1, -3, 3)).toBeCloseTo(-3);
    const between = zoomTargetY((1 + MIN_ZOOM) / 2, 1, -3, 3);
    expect(between).toBeLessThan(0);
    expect(between).toBeGreaterThan(-3);
  });
});

describe("approachPosition", () => {
  const from: Vec3 = [0, 0, 3.2];
  const to: Vec3 = [-1.3, 0, 0];

  it("starts and ends at the two positions", () => {
    const start = approachPosition(from, to, 0);
    const end = approachPosition(from, to, 1);
    for (let axis = 0; axis < 3; axis += 1) {
      expect(start[axis]).toBeCloseTo(from[axis]);
      expect(end[axis]).toBeCloseTo(to[axis]);
    }
  });

  it("never comes closer to the Earth's center than the nearer end", () => {
    const pairs: [Vec3, Vec3][] = [
      [from, to],
      [
        [0, 0, 3.2],
        [0, 0, -1.3],
      ],
      [
        [0, 4, 0],
        [0, -1.3, 0],
      ],
      [
        [2, 1, 0.5],
        [2, 1, 0.5],
      ],
    ];
    for (const [a, b] of pairs) {
      const nearest = Math.min(Math.hypot(...a), Math.hypot(...b));
      for (let step = 0; step <= 40; step += 1) {
        const point = approachPosition(a, b, step / 40);
        expect(Math.hypot(...point)).toBeGreaterThanOrEqual(nearest - 1e-9);
      }
    }
  });
});
