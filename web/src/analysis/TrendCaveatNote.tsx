import { useI18n } from "../i18n";
import type { TrendCaveat } from "./trendCaveats";

// A caveat next to a trend: the one-sentence caution is always visible, the
// numbers and sources open under a native <details>.
export function TrendCaveatNote({ caveat }: { caveat: TrendCaveat }) {
  const { t } = useI18n();
  return (
    <div className="trend-caveat" role="note">
      <p>{caveat.summary}</p>
      <details>
        <summary>{t("common.action.details")}</summary>
        <p>{caveat.details}</p>
        <p className="trend-caveat-sources">
          {t("caveats.sources", { sources: caveat.sources })}
        </p>
      </details>
    </div>
  );
}
