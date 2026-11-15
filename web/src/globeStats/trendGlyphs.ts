// Mode 1: the trend at every place. Pure rules from a row of trends.json
// (and the file's known issues) to what is drawn. Nothing is tested or
// interpreted here: significance, FDR and the unreliable verdict all come
// from the file and from trendSignal.
import { trendSignal } from "../forms/encoding";
import {
  formatChangePerDecade,
  significanceText,
  trendKey,
  type TrendEntry,
  type TrendsFile,
} from "../analysis/trends";
import { trendUnreliable } from "../analysis/trendReliability";
import { GLOBE_STATS_TEXT as T } from "./globeStatsText";

export type GlyphKind =
  // Significant after FDR correction and reliable: a filled arrow.
  | "solid"
  // Not significant, or significant before FDR correction only: an outline.
  | "hollow"
  // Significant but affected by a documented data issue: dashed, striped.
  | "unreliable"
  // No result at this place.
  | "nodata";

export type TrendGlyph = {
  placeId: string;
  placeName: string;
  lat: number;
  lon: number;
  kind: GlyphKind;
  // +1 rising, -1 falling (the sign of the slope; 1 when there is none).
  direction: 1 | -1;
  slope: number | null;
  unit: string;
  // |slope| over the scale, 0 to 1 (0 for no data).
  magnitude: number;
  // Length of the arrow in pixels.
  lengthPx: number;
  significant: boolean;
  fdr: boolean;
  unreliable: boolean;
  // One sentence of numbers; the aria-label and the tooltip.
  summary: string;
  // The parts of the sentence, for the table.
  changeText: string;
  significanceText: string;
  reliabilityText: string;
};

export const MIN_LENGTH_PX = 8;
export const MAX_LENGTH_PX = 28;
// An outline (not significant after FDR correction, including significant
// before it only) is drawn short and thin, so it never draws more attention
// than a filled arrow. The legend says "Outline only and shorter".
export const NOT_SIGNIFICANT_MAX_PX = 12;
// Stroke of an outline arrow in screen pixels (not scaled with its length).
export const OUTLINE_STROKE_PX = 1.25;
export const SCALE_QUANTILE = 0.9;

// The 90th percentile of the absolute changes (linear interpolation), so one
// extreme place does not flatten the others. 0 when there is nothing.
export function robustMax(values: number[], quantile = SCALE_QUANTILE): number {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.abs(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

// 0 to 1: how big a change is next to the scale.
export function normalizedMagnitude(slope: number, scale: number): number {
  if (!(scale > 0)) return 0;
  return Math.min(1, Math.abs(slope) / scale);
}

export function glyphLength(magnitude: number, kind: GlyphKind): number {
  if (kind === "nodata") return 0;
  const full = MIN_LENGTH_PX + (MAX_LENGTH_PX - MIN_LENGTH_PX) * magnitude;
  return kind === "hollow" ? Math.min(full, NOT_SIGNIFICANT_MAX_PX) : full;
}

type Classified = {
  kind: GlyphKind;
  direction: 1 | -1;
  slope: number | null;
  significant: boolean;
  fdr: boolean;
  unreliable: boolean;
};

// The kind of mark for one entry. trendSignal decides rising, falling, FDR
// and unreliable; the slope sign gives the direction of a mark that is not
// significant.
export function classifyTrend(
  entry: TrendEntry | undefined,
  issues: Record<string, { kind: string }> | undefined,
): Classified {
  const none = {
    kind: "nodata" as const,
    direction: 1 as const,
    slope: null,
    significant: false,
    fdr: false,
    unreliable: false,
  };
  if (!entry || entry.status !== "analyzed") return none;
  const signal = trendSignal(entry);
  if (signal.state === "unavailable" || signal.state === "insufficient") {
    return none;
  }
  const slope = entry.ols.slope_per_decade;
  const direction = slope < 0 ? -1 : 1;
  const significant = signal.state === "rising" || signal.state === "falling";
  const unreliable = trendUnreliable(entry, issues);
  if (unreliable) {
    return {
      kind: "unreliable",
      direction,
      slope,
      significant,
      fdr: significant && signal.fdr,
      unreliable: true,
    };
  }
  return {
    kind: significant && signal.fdr ? "solid" : "hollow",
    direction,
    slope,
    significant,
    fdr: signal.fdr,
    unreliable: false,
  };
}

export type GlyphPlace = {
  id: string;
  nameEn: string;
  aggregation: string;
  lat: number;
  lon: number;
};

function reliabilityOf(kind: GlyphKind): string {
  if (kind === "nodata") return "";
  return kind === "unreliable" ? T.notReliable : T.reliable;
}

// One glyph per place for one variable. `scale` is the robust maximum over
// the places that have a result.
export function buildTrendGlyphs(
  places: GlyphPlace[],
  variableId: string,
  trends: TrendsFile,
  variableName: string,
): TrendGlyph[] {
  const rows = places.map((place) => {
    const entry =
      trends.series[trendKey(variableId, place.id, place.aggregation)];
    return { place, entry, ...classifyTrend(entry, trends.known_issues) };
  });
  const scale = robustMax(
    rows.flatMap((row) => (row.slope === null ? [] : [row.slope])),
  );
  return rows.map((row) => {
    const magnitude =
      row.slope === null ? 0 : normalizedMagnitude(row.slope, scale);
    const analyzed = row.entry?.status === "analyzed" ? row.entry : null;
    const lengthPx = glyphLength(magnitude, row.kind);
    const unit = row.entry?.unit ?? "";
    const changeText = analyzed
      ? formatChangePerDecade(
          analyzed.ols.slope_per_decade,
          analyzed.ols.ci_per_decade,
          analyzed.unit,
          trends.parameters.alpha,
        )
      : "";
    const significance = analyzed
      ? significanceText(analyzed.ols, row.unreliable)
      : row.entry?.status === "insufficient"
        ? `${T.notAnalysed}: ${row.entry.reason.text_en}`
        : T.noResult;
    const reliability = reliabilityOf(row.kind);
    const parts = [
      `${row.place.nameEn}, ${variableName}`,
      changeText || significance,
      changeText ? significance : "",
      reliability,
    ].filter((part) => part.length > 0);
    return {
      placeId: row.place.id,
      placeName: row.place.nameEn,
      lat: row.place.lat,
      lon: row.place.lon,
      kind: row.kind,
      direction: row.direction,
      slope: row.slope,
      unit,
      magnitude,
      lengthPx,
      significant: row.significant,
      fdr: row.fdr,
      unreliable: row.unreliable,
      summary: `${parts.join(": ").replace(": ", ": ")}.`,
      changeText,
      significanceText: significance,
      reliabilityText: reliability,
    };
  });
}

export type GlyphCounts = {
  solidUp: number;
  solidDown: number;
  hollow: number;
  unreliable: number;
  nodata: number;
};

// The five groups of the delivery note: how many places are drawn each way.
export function countGlyphs(glyphs: TrendGlyph[]): GlyphCounts {
  const counts: GlyphCounts = {
    solidUp: 0,
    solidDown: 0,
    hollow: 0,
    unreliable: 0,
    nodata: 0,
  };
  for (const glyph of glyphs) {
    if (glyph.kind === "solid") {
      if (glyph.direction > 0) counts.solidUp += 1;
      else counts.solidDown += 1;
    } else if (glyph.kind === "hollow") counts.hollow += 1;
    else if (glyph.kind === "unreliable") counts.unreliable += 1;
    else counts.nodata += 1;
  }
  return counts;
}

// Which variable the marks follow: the charted one, else the open layer
// with the most places drawn filled (significant after FDR correction and
// reliable); the first open layer on a tie. `filledPlaces` counts them.
export function followedVariable(
  chartId: string | null,
  openIds: string[],
  filledPlaces: (variableId: string) => number,
): string | null {
  if (chartId) return chartId;
  let best: string | null = null;
  let bestCount = -1;
  for (const id of openIds) {
    const count = filledPlaces(id);
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

// Degrees between two places on the sphere.
export function angularDistanceDeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(aLat * rad) * Math.sin(bLat * rad) +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.cos((aLon - bLon) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

// How far apart (in degrees) two marks must be to both be drawn, per unit of
// camera distance above the surface (globe radius 1). From the starting view
// (distance 3.2) that is about 3.5 degrees, so the five Taiwan places share
// one mark; closer in they separate.
export const SEPARATION_DEG_PER_DISTANCE = 1.6;

export function minSeparationDeg(cameraDistance: number): number {
  return Math.max(0, (cameraDistance - 1) * SEPARATION_DEG_PER_DISTANCE);
}

// The marks to draw: the selected place first, then the others in order,
// each only when it is at least `minDeg` from every mark already kept.
// Returned in the original order.
export function spreadMarks<
  T extends { placeId: string; lat: number; lon: number },
>(marks: T[], selectedId: string, minDeg: number): T[] {
  const ordered = [
    ...marks.filter((mark) => mark.placeId === selectedId),
    ...marks.filter((mark) => mark.placeId !== selectedId),
  ];
  const kept = new Set<T>();
  for (const mark of ordered) {
    const clear = [...kept].every(
      (other) =>
        angularDistanceDeg(mark.lat, mark.lon, other.lat, other.lon) >= minDeg,
    );
    if (clear) kept.add(mark);
  }
  return marks.filter((mark) => kept.has(mark));
}
