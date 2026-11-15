// Camera math of the layer view. Pure functions, no three.js objects.
import {
  LAYER_GAP,
  PLATFORM_DEPTH,
  PLATFORM_WIDTH,
  type CompanionPlacement,
} from "./strataLayout";
import { strata } from "./strataSpec";

export type Vec3 = [number, number, number];

const DEG = Math.PI / 180;

// Depression = how far the camera looks down from the horizon. The view stays
// oblique: never flat from the side, never straight down.
export const MIN_DEPRESSION = 28 * DEG;
export const MAX_DEPRESSION = 65 * DEG;
export const DEFAULT_DEPRESSION = 40 * DEG;
export const DEFAULT_AZIMUTH = -28 * DEG;
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 1.2;
// Zoom used when one stratum is expanded.
export const FOCUS_ZOOM = 0.62;
export const FOV_DEG = 40;
// Where the entry starts: almost straight down, close to the ground.
export const ENTRY_DEPRESSION = 86 * DEG;
export const ENTRY_DISTANCE = 3.4;
export const ENTRY_SECONDS = 2.2;

export type OrbitPose = {
  // Rotation about the vertical axis, radians.
  azimuth: number;
  depression: number;
  distance: number;
  // Height the camera looks at.
  targetY: number;
};

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampDepression(value: number): number {
  return clamp(value, MIN_DEPRESSION, MAX_DEPRESSION);
}

export function clampZoom(value: number): number {
  return clamp(value, MIN_ZOOM, MAX_ZOOM);
}

// Two fingers: the picture follows the distance between them. Fingers
// moving apart (distance grows) bring the camera closer (zoom shrinks).
export function pinchZoom(
  zoom: number,
  previousDistance: number,
  distance: number,
): number {
  if (!(previousDistance > 0) || !(distance > 0)) return clampZoom(zoom);
  return clampZoom(zoom * (previousDistance / distance));
}

// A pointer has to move this far (pixels) before a touch counts as a drag;
// less is a tap (selecting a layer). The same value R3F uses for clicks.
export const TAP_SLOP = 5;

// The orbit the view starts with and "Reset view" returns to. Fresh object
// each call: the caller mutates it.
export function defaultOrbit() {
  return {
    azimuth: DEFAULT_AZIMUTH,
    depression: DEFAULT_DEPRESSION,
    zoom: 1,
    pointerFraction: 0.5,
  };
}

// Up and down arrow keys move between the six layers (top first). Returns
// the index of the next one, never past the ends; `current` -1 (nothing
// focused yet) goes to the first on "down" and the last on "up".
export function nextLayerIndex(
  count: number,
  current: number,
  direction: "up" | "down",
): number {
  if (count <= 0) return -1;
  if (current < 0) return direction === "down" ? 0 : count - 1;
  const next = direction === "down" ? current + 1 : current - 1;
  return Math.min(count - 1, Math.max(0, next));
}

export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function posePosition(pose: OrbitPose): Vec3 {
  const flat = Math.cos(pose.depression) * pose.distance;
  return [
    Math.sin(pose.azimuth) * flat,
    pose.targetY + Math.sin(pose.depression) * pose.distance,
    Math.cos(pose.azimuth) * flat,
  ];
}

// Free space kept around the stack when it is fitted (scene units).
export const FIT_MARGIN = 0.5;

// Distance at which the pulled-apart stack fits a viewport of this aspect
// ratio (width / height) at the default depression.
export function fitDistance(aspect: number): number {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const half = Math.tan((FOV_DEG * DEG) / 2);
  const diagonal = Math.hypot(PLATFORM_WIDTH, PLATFORM_DEPTH);
  const tall =
    (strata.length - 1) * LAYER_GAP * Math.cos(DEFAULT_DEPRESSION) +
    diagonal * Math.sin(DEFAULT_DEPRESSION) +
    FIT_MARGIN;
  const wide = diagonal + 0.6;
  return Math.max(tall / (2 * half), wide / (2 * half * safeAspect));
}

// Entry (t 0 → 1) and, run backwards, exit: from looking almost straight
// down at the ground to the oblique pose the user controls.
export function entryPose(t: number, final: OrbitPose): OrbitPose {
  const amount = easeInOut(t);
  return {
    azimuth: lerp(0, final.azimuth, amount),
    depression: lerp(ENTRY_DEPRESSION, final.depression, amount),
    distance: lerp(ENTRY_DISTANCE, final.distance, amount),
    targetY: lerp(0, final.targetY, amount),
  };
}

// How far the strata are pulled apart during the entry: they start to
// separate once the camera has begun to tilt.
export function entrySpread(t: number): number {
  return easeInOut(clamp((t - 0.15) / 0.85, 0, 1));
}

// The height the camera looks at while zooming with no stratum expanded: the
// middle of the stack when zoomed out, the height under the pointer
// (`pointerFraction` 0 = top of the screen, 1 = bottom) when zoomed in.
export function zoomTargetY(
  zoom: number,
  pointerFraction: number,
  bottom: number,
  top: number,
): number {
  const middle = (bottom + top) / 2;
  const pointed = lerp(top, bottom, clamp(pointerFraction, 0, 1));
  const amount = clamp((1 - zoom) / (1 - MIN_ZOOM), 0, 1);
  return lerp(middle, pointed, amount);
}

// The approach in the globe scene: from one camera position to another
// around the Earth's center. Direction turns along the great arc and the
// distance changes smoothly, so the path never cuts through the globe.
export function approachPosition(from: Vec3, to: Vec3, t: number): Vec3 {
  const amount = easeInOut(t);
  const fromLength = Math.hypot(...from);
  const toLength = Math.hypot(...to);
  if (fromLength === 0 || toLength === 0) return amount < 1 ? from : to;
  const a: Vec3 = [
    from[0] / fromLength,
    from[1] / fromLength,
    from[2] / fromLength,
  ];
  const b: Vec3 = [to[0] / toLength, to[1] / toLength, to[2] / toLength];
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  const angle = Math.acos(dot);
  const length = lerp(fromLength, toLength, amount);
  let direction: Vec3;
  if (angle < 1e-4) {
    direction = b;
  } else if (Math.PI - angle < 1e-3) {
    // Opposite sides: any great arc works; go over a fixed perpendicular.
    const axis: Vec3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const perp: Vec3 = [
      a[1] * axis[2] - a[2] * axis[1],
      a[2] * axis[0] - a[0] * axis[2],
      a[0] * axis[1] - a[1] * axis[0],
    ];
    const norm = Math.hypot(...perp);
    const swing = amount * Math.PI;
    direction = [
      a[0] * Math.cos(swing) + (perp[0] / norm) * Math.sin(swing),
      a[1] * Math.cos(swing) + (perp[1] / norm) * Math.sin(swing),
      a[2] * Math.cos(swing) + (perp[2] / norm) * Math.sin(swing),
    ];
  } else {
    const sin = Math.sin(angle);
    const wa = Math.sin((1 - amount) * angle) / sin;
    const wb = Math.sin(amount * angle) / sin;
    direction = [
      a[0] * wa + b[0] * wb,
      a[1] * wa + b[1] * wb,
      a[2] * wa + b[2] * wb,
    ];
  }
  return [direction[0] * length, direction[1] * length, direction[2] * length];
}

// Globe-scene distances (Earth radius = 1).
export const APPROACH_DISTANCE = 1.3;
export const APPROACH_SECONDS = 1.8;
// Closer than this, the "Enter layer view" hint is offered.
export const NEAR_HINT_DISTANCE = 1.9;

// Screen space the HTML around the picture takes (pixels). The stack is
// fitted into, and centered on, what is left. Docking rules of the layer
// view (the CSS that places the panels is in strata.css and has to agree):
//   wide (> 1180 px)   HUD row on top; the legend and the layer labels in a
//                      left column; the Layers panel on the right, and the
//                      time series chart, when open, to its left; the
//                      timeline bar at the bottom.
//   medium (≤ 1180 px) the same, but an open chart takes the place of the
//                      Layers panel, so the free area does not change.
//   compact (≤ 900 px) the labels shrink to values only, a narrower column.
//   narrow (≤ 700 px)  legend on top, the six layer chips in a row under it
//                      (scrolls sideways), the stack across the full width,
//                      the timeline bar and the short sheet of the Layers
//                      panel at the bottom.
//   short (height ≤ 500 px, wider than narrow: a phone turned sideways)
//                      the labels are left out so the stack, the timeline
//                      bar and the Layers panel all fit; the legend shrinks
//                      to its title row.
export type ViewInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const NARROW_WIDTH = 700;
export const MEDIUM_WIDTH = 1180;
// Up to this width the labels show values only and the column narrows.
export const COMPACT_WIDTH = 900;
// At or below this height (and wider than NARROW_WIDTH) the layout is "short".
export const SHORT_HEIGHT = 500;
// Height kept free at the bottom for the timeline bar (index.css:
// --timeline-bottom + --timeline-height, plus a gap).
export const TIMELINE_RESERVE = 192;
export const TIMELINE_RESERVE_NARROW = 216;
// The HUD row (index.css: panels start at 64px).
export const HUD_RESERVE = 64;
// Left column: 12px margin + the 270px labels + a gap (strata.css).
export const LABEL_COLUMN = 294;
// Compact labels (values only): 12px margin + 168px + a gap (strata.css).
export const LABEL_COLUMN_COMPACT = 188;
// Short (a phone turned sideways): the legend shrinks to a title pill.
export const LEGEND_COLUMN_SHORT = 212;
// Narrow: legend (12px + one row + details line) and the row of layer chips
// under it (strata.css .strata-labelbar).
export const PHONE_TOP = 156;
// Right column: the Layers panel (306px with its padding) + margins.
export const PANEL_COLUMN = 326;
// The chart docked left of the Layers panel: 380px + a gap (strata.css).
export const CHART_COLUMN = 392;
// Height of the credit in the bottom-left corner, which the label column
// stops above on a wide screen.
export const CREDIT_RESERVE = 78;

// Room right of the stack for the companions standing beside it (up to three
// per stratum, strataLayout.ts companionRowXs), and the narrowest the stack
// itself may get before they go back onto the platforms.
export const COMPANION_COLUMN = 252;
export const MIN_STACK_WIDTH = 300;

// How big the companions beside the stack are, from the largest to the
// smallest. Each tier is a figure size (px) and how many caption lines sit
// under it (2 = name and value, 1 = value only; the name stays in the left
// column, the tooltip and the accessible name). `rowHeight` is the height of
// one row with its caption, matching strata.css (12px caption text, figure
// height = 124/120 × size).
export type CompanionTier = {
  id: "full" | "medium" | "compact";
  figure: number;
  captionLines: 1 | 2;
  rowHeight: number;
};
export const COMPANION_TIERS: readonly CompanionTier[] = [
  { id: "full", figure: 60, captionLines: 2, rowHeight: 94 },
  { id: "medium", figure: 48, captionLines: 2, rowHeight: 82 },
  { id: "compact", figure: 40, captionLines: 1, rowHeight: 59 },
];
// Gap kept between two rows (the same one stackLabelTops uses).
export const COMPANION_ROW_GAP = 4;
// The first row starts below the folded Companions chip: the HUD row plus
// the chip's height and a gap (StrataScene measures the chip itself).
export const COMPANION_TOP_RESERVE = HUD_RESERVE + 50;

// Height the rows of companions beside the stack may take: between the
// Companions chip and the timeline bar.
export function companionRowsSpace(width: number, height: number): number {
  const bottom = viewInsets(width, height).bottom;
  return Math.max(0, height - bottom - COMPANION_TOP_RESERVE);
}

export function companionRowsHeight(rows: number, tier: CompanionTier): number {
  if (rows <= 0) return 0;
  return rows * tier.rowHeight + (rows - 1) * COMPANION_ROW_GAP;
}

// How the companions are laid out: beside the stack in the largest tier
// whose `rows` rows (one per stratum that has a switched-on layer) fit
// between the Companions chip and the timeline bar; the smaller tiers only
// when the larger do not fit. When even the smallest does not fit, or the
// width does not allow a column beside the stack, they stand on the
// platforms (where the layer view stood before the row existed).
export type CompanionFit =
  | { placement: "beside"; tier: CompanionTier }
  | { placement: "on"; tier: null };

export function companionFit(
  width: number,
  height: number,
  chartOpen = false,
  rows: number = strata.length,
): CompanionFit {
  const on: CompanionFit = { placement: "on", tier: null };
  if (!(width > MEDIUM_WIDTH)) return on;
  const insets = viewInsets(width, height, chartOpen);
  const stack = width - insets.left - insets.right - COMPANION_COLUMN;
  if (stack < MIN_STACK_WIDTH) return on;
  const space = companionRowsSpace(width, height);
  const tier = COMPANION_TIERS.find(
    (item) => companionRowsHeight(rows, item) <= space,
  );
  return tier ? { placement: "beside", tier } : on;
}

// Beside the stack on a wide screen while the stack keeps at least
// MIN_STACK_WIDTH after reserving their column (the docked chart takes
// room too) and the rows fit in the height; on the platforms otherwise.
export function companionPlacement(
  width: number,
  height: number,
  chartOpen = false,
  rows: number = strata.length,
): CompanionPlacement {
  return companionFit(width, height, chartOpen, rows).placement;
}

export function viewInsets(
  width: number,
  height: number,
  chartOpen = false,
  companions: CompanionPlacement = "on",
): ViewInsets {
  if (!(width > 0) || !(height > 0)) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const mode = layoutMode(width, height);
  if (mode === "phone") {
    // Legend and the row of layer chips at the top; the timeline bar and,
    // above it, the short sheet of the layer panel at the bottom.
    return {
      top: Math.min(PHONE_TOP, height * 0.3),
      right: 0,
      bottom: Math.min(TIMELINE_RESERVE_NARROW + height * 0.17, height * 0.5),
      left: 0,
    };
  }
  const chart = chartOpen && width > MEDIUM_WIDTH ? CHART_COLUMN : 0;
  const beside =
    companions === "beside" && width > MEDIUM_WIDTH ? COMPANION_COLUMN : 0;
  return {
    top: HUD_RESERVE,
    right: PANEL_COLUMN + chart + beside,
    bottom: TIMELINE_RESERVE,
    left:
      mode === "short"
        ? LEGEND_COLUMN_SHORT
        : mode === "compact"
          ? LABEL_COLUMN_COMPACT
          : LABEL_COLUMN,
  };
}

export type LayoutMode = "wide" | "medium" | "compact" | "phone" | "short";

// Which of the docking layouts above a window gets. strata.css has the same
// breakpoints (media queries) and has to agree.
export function layoutMode(width: number, height: number): LayoutMode {
  if (width <= NARROW_WIDTH) return "phone";
  if (height <= SHORT_HEIGHT) return "short";
  if (width <= COMPACT_WIDTH) return "compact";
  if (width <= MEDIUM_WIDTH) return "medium";
  return "wide";
}

// The lowest screen height (pixels from the top) the label column may reach:
// the credit on a wide screen, the timeline bar where the bar sits under
// the column.
export function labelCeiling(width: number, height: number): number {
  if (width > MEDIUM_WIDTH) return height - CREDIT_RESERVE;
  return height - viewInsets(width, height).bottom;
}

// How far the picture's center moves from the middle of the viewport, and
// the aspect ratio (width / height) of the free area, and how much farther
// the camera must be than fitDistance(aspect).
export function insetView(
  width: number,
  height: number,
  insets: ViewInsets,
): { offsetX: number; offsetY: number; aspect: number; scale: number } {
  const freeWidth = Math.max(1, width - insets.left - insets.right);
  const freeHeight = Math.max(1, height - insets.top - insets.bottom);
  return {
    offsetX: (insets.left - insets.right) / 2,
    offsetY: (insets.top - insets.bottom) / 2,
    aspect: freeWidth / freeHeight,
    // The camera's field of view spans the whole viewport height, so the
    // distance that fits the free area is this much larger.
    scale: Math.max(1, height) / freeHeight,
  };
}
