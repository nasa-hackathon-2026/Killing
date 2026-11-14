// Camera math of the layer view. Pure functions, no three.js objects.
import { LAYER_GAP, PLATFORM_DEPTH, PLATFORM_WIDTH } from "./strataLayout";
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

// Distance at which the pulled-apart stack fits a viewport of this aspect
// ratio (width / height) at the default depression.
export function fitDistance(aspect: number): number {
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const half = Math.tan((FOV_DEG * DEG) / 2);
  const diagonal = Math.hypot(PLATFORM_WIDTH, PLATFORM_DEPTH);
  const tall =
    (strata.length - 1) * LAYER_GAP * Math.cos(DEFAULT_DEPRESSION) +
    diagonal * Math.sin(DEFAULT_DEPRESSION) +
    1;
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

// Screen space the HTML around the picture takes (pixels): the HUD and the
// legend at the top, and on a narrow screen the labels on the left and the
// layer panel at the bottom. The stack is fitted into what is left.
export type ViewInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const NARROW_WIDTH = 700;
// Height kept free at the bottom for the timeline bar (index.css:
// --timeline-bottom + --timeline-height, plus a gap).
export const TIMELINE_RESERVE = 192;
export const TIMELINE_RESERVE_NARROW = 216;

export function viewInsets(width: number, height: number): ViewInsets {
  if (!(width > 0) || !(height > 0)) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (width <= NARROW_WIDTH) {
    // Legend at the top; labels on the left; the timeline bar and, above
    // it, the short sheet of the layer panel at the bottom.
    return {
      top: Math.min(150, height * 0.18),
      right: 0,
      bottom: Math.min(TIMELINE_RESERVE_NARROW + height * 0.17, height * 0.5),
      left: width * 0.34,
    };
  }
  return {
    top: Math.min(150, height * 0.18),
    right: 0,
    bottom: Math.min(TIMELINE_RESERVE, height * 0.3),
    left: 0,
  };
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
