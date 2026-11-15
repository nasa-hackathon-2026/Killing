import { describe, expect, it } from "vitest";
import {
  approachPosition,
  clampDepression,
  clampZoom,
  DEFAULT_AZIMUTH,
  DEFAULT_DEPRESSION,
  ENTRY_DEPRESSION,
  ENTRY_DISTANCE,
  entryPose,
  entrySpread,
  CHART_COLUMN,
  COMPANION_COLUMN,
  COMPANION_ROW_GAP,
  COMPANION_TIERS,
  COMPANION_TOP_RESERVE,
  companionFit,
  companionPlacement,
  companionRowsHeight,
  CREDIT_RESERVE,
  fitDistance,
  HUD_RESERVE,
  insetView,
  LABEL_COLUMN,
  labelCeiling,
  pinchZoom,
  defaultOrbit,
  nextLayerIndex,
  layoutMode,
  COMPACT_WIDTH,
  SHORT_HEIGHT,
  LABEL_COLUMN_COMPACT,
  LEGEND_COLUMN_SHORT,
  PHONE_TOP,
  MEDIUM_WIDTH,
  PANEL_COLUMN,
  MAX_DEPRESSION,
  MIN_DEPRESSION,
  MAX_ZOOM,
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
    // Narrow: no side column, the stack gets the whole width.
    expect(narrow.left).toBe(0);
    expect(narrow.right).toBe(0);
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

describe("where the layer view's companions stand", () => {
  it("lines them up beside the stack on a wide screen", () => {
    expect(companionPlacement(1440, 900)).toBe("beside");
    expect(companionPlacement(MEDIUM_WIDTH + 1, 768)).toBe("beside");
  });

  it("keeps them on the platforms at 1180 px and narrower", () => {
    expect(companionPlacement(MEDIUM_WIDTH, 900)).toBe("on");
    expect(companionPlacement(1000, 800)).toBe("on");
    expect(companionPlacement(NARROW_WIDTH, 844)).toBe("on");
  });

  it("keeps them on the platforms when the docked chart leaves no room beside the stack", () => {
    expect(companionPlacement(1400, 900, true)).toBe("on");
    expect(companionPlacement(1920, 1080, true)).toBe("beside");
  });

  it("reserves a column right of the stack only while they stand beside it", () => {
    expect(viewInsets(1440, 900, false, "beside").right).toBe(
      PANEL_COLUMN + COMPANION_COLUMN,
    );
    expect(viewInsets(1440, 900, false, "on")).toEqual(viewInsets(1440, 900));
    expect(viewInsets(1920, 1080, true, "beside").right).toBe(
      PANEL_COLUMN + CHART_COLUMN + COMPANION_COLUMN,
    );
  });
});

describe("how many companion rows fit beside the stack", () => {
  // 3 layers on (3 strata), then 6 and 12 layers (every stratum).
  const rowCounts = [3, 6, 6];
  const heights = [900, 720, 600];
  const widths = [1440, 1366, 1280];

  it("never lets a row run under the timeline bar or up into the HUD", () => {
    for (const width of widths) {
      for (const height of heights) {
        for (const rows of rowCounts) {
          const fit = companionFit(width, height, false, rows);
          if (fit.placement === "on") continue;
          const top = COMPANION_TOP_RESERVE;
          const bottom = top + companionRowsHeight(rows, fit.tier);
          const timelineTop = height - viewInsets(width, height).bottom;
          expect(top).toBeGreaterThanOrEqual(HUD_RESERVE);
          expect(bottom).toBeLessThanOrEqual(timelineTop);
        }
      }
    }
  });

  it("uses the largest tier that fits and shrinks before leaving the row", () => {
    // 6 rows: full size at 900 px, a smaller tier at 720 px, the platforms
    // at 600 px.
    expect(companionFit(1440, 900, false, 6)).toMatchObject({
      placement: "beside",
      tier: { id: "full" },
    });
    expect(companionFit(1280, 720, false, 6)).toMatchObject({
      placement: "beside",
      tier: { id: "compact" },
    });
    expect(companionFit(1280, 600, false, 6).placement).toBe("on");
    // Three rows keep full size at 720 px.
    expect(companionFit(1280, 720, false, 3)).toMatchObject({
      placement: "beside",
      tier: { id: "full" },
    });
  });

  it("goes down the tiers in order and the platforms are the last resort", () => {
    const ids: string[] = [];
    for (let height = 1000; height >= 400; height -= 10) {
      const fit = companionFit(1440, height, false, 6);
      ids.push(fit.tier ? fit.tier.id : "on");
    }
    const order = ["full", "medium", "compact", "on"];
    const ranks = ids.map((id) => order.indexOf(id));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ids)).toEqual(new Set(order));
  });

  it("lists the tiers from the largest to the smallest, each shorter than the last", () => {
    for (let index = 1; index < COMPANION_TIERS.length; index += 1) {
      const larger = COMPANION_TIERS[index - 1];
      const smaller = COMPANION_TIERS[index];
      expect(smaller?.figure).toBeLessThan(larger?.figure ?? 0);
      expect(smaller?.rowHeight).toBeLessThan(larger?.rowHeight ?? 0);
    }
    expect(companionRowsHeight(0, COMPANION_TIERS[0]!)).toBe(0);
    expect(companionRowsHeight(2, COMPANION_TIERS[0]!)).toBe(
      2 * COMPANION_TIERS[0]!.rowHeight + COMPANION_ROW_GAP,
    );
  });

  it("keeps them on the platforms on the narrow and medium widths whatever the height", () => {
    for (const [width, height] of [
      [1024, 768],
      [768, 1024],
      [390, 844],
      [844, 390],
    ] as const) {
      expect(companionFit(width, height, false, 3).placement).toBe("on");
    }
  });
});

describe("layout modes and the free area of the stack", () => {
  it("names the mode of a window by width and height", () => {
    expect(layoutMode(1440, 900)).toBe("wide");
    expect(layoutMode(MEDIUM_WIDTH + 1, 720)).toBe("wide");
    expect(layoutMode(1024, 768)).toBe("medium");
    expect(layoutMode(COMPACT_WIDTH + 1, 1024)).toBe("medium");
    expect(layoutMode(768, 1024)).toBe("compact");
    expect(layoutMode(NARROW_WIDTH + 1, 1024)).toBe("compact");
    expect(layoutMode(NARROW_WIDTH, 844)).toBe("phone");
    expect(layoutMode(390, 844)).toBe("phone");
    // A phone turned sideways is wider than narrow but not tall.
    expect(layoutMode(844, 390)).toBe("short");
    expect(layoutMode(1024, SHORT_HEIGHT)).toBe("short");
    expect(layoutMode(1024, SHORT_HEIGHT + 1)).toBe("medium");
  });

  it("gives the compact, short and narrow layouts the columns they need", () => {
    expect(viewInsets(768, 1024).left).toBe(LABEL_COLUMN_COMPACT);
    expect(viewInsets(844, 390).left).toBe(LEGEND_COLUMN_SHORT);
    expect(viewInsets(390, 844).top).toBe(PHONE_TOP);
  });

  it("keeps the timeline bar's room whatever the height", () => {
    for (const [width, height] of [
      [1440, 900],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [844, 390],
    ] as const) {
      expect(viewInsets(width, height).bottom).toBe(TIMELINE_RESERVE);
    }
  });

  it("leaves a free area for the stack in every size that is tested", () => {
    for (const [width, height] of [
      [1440, 900],
      [1366, 768],
      [1280, 720],
      [1024, 768],
      [768, 1024],
      [390, 844],
      [844, 390],
    ] as const) {
      const insets = viewInsets(width, height);
      expect(width - insets.left - insets.right).toBeGreaterThanOrEqual(240);
      expect(height - insets.top - insets.bottom).toBeGreaterThanOrEqual(120);
    }
  });
});

describe("touch and keyboard helpers", () => {
  it("zooms in when the fingers move apart and out when they come together", () => {
    expect(pinchZoom(1, 100, 125)).toBeCloseTo(0.8);
    expect(pinchZoom(0.8, 100, 80)).toBeCloseTo(1);
  });

  it("keeps a pinch inside the zoom limits and ignores a broken distance", () => {
    expect(pinchZoom(1, 100, 10000)).toBe(MIN_ZOOM);
    expect(pinchZoom(1, 10000, 1)).toBe(MAX_ZOOM);
    expect(pinchZoom(0.9, 0, 50)).toBe(0.9);
    expect(pinchZoom(0.9, 50, Number.NaN)).toBe(0.9);
  });

  it("starts a reset from the view the layer view opens with", () => {
    const orbit = defaultOrbit();
    expect(orbit).toEqual({
      azimuth: DEFAULT_AZIMUTH,
      depression: DEFAULT_DEPRESSION,
      zoom: 1,
      pointerFraction: 0.5,
    });
    orbit.zoom = 0.5;
    expect(defaultOrbit().zoom).toBe(1);
  });

  it("walks the six layers with the arrow keys and stops at the ends", () => {
    expect(nextLayerIndex(6, -1, "down")).toBe(0);
    expect(nextLayerIndex(6, -1, "up")).toBe(5);
    expect(nextLayerIndex(6, 2, "down")).toBe(3);
    expect(nextLayerIndex(6, 2, "up")).toBe(1);
    expect(nextLayerIndex(6, 5, "down")).toBe(5);
    expect(nextLayerIndex(6, 0, "up")).toBe(0);
    expect(nextLayerIndex(0, 0, "down")).toBe(-1);
  });
});
