// Wording helpers shared by the tabs. Numbers are formatted with the same
// functions as the rest of the page (analysis/trends.ts), so a value never
// shows with a different precision here.
import {
  formatChangePerDecade,
  formatSlope,
  type AnalyzedTrend,
} from "../analysis/trends";
import { localNumber } from "../i18n";
import { changeOverPeriod, periodMonths } from "./stats";

export function formatChange(
  trend: AnalyzedTrend,
  full: boolean,
  alpha = 0.05,
): string {
  return full
    ? formatChangePerDecade(
        trend.ols.slope_per_decade,
        trend.ols.ci_per_decade,
        trend.unit,
        alpha,
      )
    : formatSlope(
        trend.ols.slope_per_decade,
        trend.ols.ci_per_decade,
        trend.unit,
      );
}

// The slope times the analysed period, at the slope's own precision.
export function formatTotal(trend: AnalyzedTrend): string {
  const total = changeOverPeriod(
    trend.ols.slope_per_decade,
    trend.data.first_month,
    trend.data.last_month,
  );
  return formatSlope(total, [total, total], trend.unit);
}

// Length of the analysed period in years, one decimal.
export function recordYears(trend: AnalyzedTrend): string {
  return localNumber(
    (periodMonths(trend.data.first_month, trend.data.last_month) / 12).toFixed(
      1,
    ),
  );
}
