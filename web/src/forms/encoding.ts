// How a value and a trend become what a form draws. Pure functions; the
// per-variable numbers they read live in formMapping.ts.
import type { TrendEntry } from "../analysis/trends";
import { clampUnit, MAX_FORM_PARTICLES, particleCount } from "./particleField";

export type SpeedLaw = "linear" | "sqrt";

export type EncodingSpec = {
  // Particles drawn when the value is at its maximum (value 1).
  maxCount: number;
  // Size multiplier at value 0 and at value 1.
  size: [number, number];
  // Speed multiplier at value 0 and at value 1.
  speed: [number, number];
  // "sqrt": the value is treated as an energy and speed follows its square
  // root, as molecular speed follows sqrt(T). The range is still exaggerated.
  speedLaw: SpeedLaw;
};

export type FormEncoding = {
  count: number;
  size: number;
  speed: number;
};

function lerp(range: [number, number], amount: number): number {
  return range[0] + (range[1] - range[0]) * amount;
}

export type EncodingOptions = {
  // The layer's share of the whole-globe budget (see layerParticleCap).
  cap?: number;
  // False for a month without data: nothing is drawn.
  hasData?: boolean;
};

// `value` is the normalized reading: 0 is the series' own minimum, 1 its own
// maximum. A month with data keeps a small floor of particles so the minimum
// does not look like a missing month.
export function encodeForm(
  value: number,
  spec: EncodingSpec,
  options: EncodingOptions = {},
): FormEncoding {
  const amount = clampUnit(value);
  const cap = Math.min(
    MAX_FORM_PARTICLES,
    Math.max(0, spec.maxCount),
    Math.max(0, options.cap ?? MAX_FORM_PARTICLES),
  );
  const speed =
    spec.speedLaw === "sqrt"
      ? Math.sqrt(lerp([spec.speed[0] ** 2, spec.speed[1] ** 2], amount))
      : lerp(spec.speed, amount);
  return {
    count: particleCount(value, cap, options.hasData ?? true),
    size: lerp(spec.size, amount),
    speed,
  };
}

export type TrendState =
  "rising" | "falling" | "not-significant" | "insufficient" | "unavailable";

export type TrendSignal = {
  state: TrendState;
  // True when the trend is still significant after the FDR correction.
  fdr: boolean;
};

// Reads the same test the layer panel words its sentence from: the linear
// trend's t-test after the lag-1 autocorrelation correction. No judgment is
// added here; direction is the sign of the slope and nothing more.
export function trendSignal(entry: TrendEntry | undefined): TrendSignal {
  if (!entry) return { state: "unavailable", fdr: false };
  if (entry.status === "insufficient") {
    return { state: "insufficient", fdr: false };
  }
  if (entry.ols.significant === null) {
    return { state: "unavailable", fdr: false };
  }
  const slope = entry.ols.slope_per_decade;
  if (!entry.ols.significant || slope === 0) {
    return { state: "not-significant", fdr: false };
  }
  return {
    state: slope > 0 ? "rising" : "falling",
    fdr: entry.ols.significant_fdr === true,
  };
}

export type TrendMark = { glyph: string; label: string };

export function trendMark(signal: TrendSignal): TrendMark {
  switch (signal.state) {
    case "rising":
      return signal.fdr
        ? { glyph: "▲", label: "Rising, significant" }
        : { glyph: "△", label: "Rising, significant before FDR only" };
    case "falling":
      return signal.fdr
        ? { glyph: "▼", label: "Falling, significant" }
        : { glyph: "▽", label: "Falling, significant before FDR only" };
    case "not-significant":
      return { glyph: "◇", label: "Not significant" };
    case "insufficient":
      return { glyph: "·", label: "Insufficient data" };
    case "unavailable":
      return { glyph: "", label: "No trend result" };
  }
}

// +1 points away from the Earth, -1 towards it, 0 draws no arrows.
export function trendArrowDirection(signal: TrendSignal | undefined): number {
  if (signal?.state === "rising") return 1;
  if (signal?.state === "falling") return -1;
  return 0;
}
