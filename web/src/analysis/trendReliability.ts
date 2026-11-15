// Which kinds of documented data issue (data/seed/cleaning.json, copied into
// trends.json as `known_issues`) make a series' trend unreliable as a climate
// signal. This table is the one place that decides it: add a row when the
// seed gains a new `kind`. A kind that is not listed counts as false, so a
// new issue never changes a mark by accident.
import type { TrendEntry } from "./trends";

export const ISSUE_KIND_AFFECTS_TREND: Record<string, boolean> = {
  // A step or break in the product (an input or algorithm changed).
  discontinuity: true,
  // The sampling of the record changed (orbit, overpass time, coverage).
  sampling_change: true,
  // Two products disagree on the sign of the trend.
  product_disagreement: true,
  // Bookkeeping fields (counts, variances, viewing geometry): their trend
  // follows sampling or algorithm changes, not a physical quantity.
  auxiliary: true,
  // Months without a composite or without data: gaps, not a bias in time.
  missing_composites: false,
  no_data: false,
};

export function issueAffectsTrend(kind: string): boolean {
  return ISSUE_KIND_AFFECTS_TREND[kind] === true;
}

// True when the series lists at least one issue of a trend-affecting kind.
export function trendUnreliable(
  entry: TrendEntry | undefined,
  issues: Record<string, { kind: string }> | undefined,
): boolean {
  if (entry?.status !== "analyzed" || !issues) return false;
  return (entry.known_issues ?? []).some((id) => {
    const issue = issues[id];
    return issue !== undefined && issueAffectsTrend(issue.kind);
  });
}

// Said wherever a significant trend of such a series is shown.
export const UNRELIABLE_TREND_LABEL =
  "Trend not reliable as a climate signal: documented data issue";
