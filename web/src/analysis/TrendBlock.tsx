// The trend of one variable as the Layers panel and the layer view show it.
// Researcher: the full line (change per decade with its confidence interval,
// the test wording, the period) and the caution note. Everyone and Student:
// a plain label, the caution in one line when there is one, and the same
// full line folded under "Details". The numbers are the same in every role.
import { trendLabel, type TrendSignal } from "../forms/encoding";
import { useI18n } from "../i18n";
import { variableDefinition } from "../i18n/names";
import { TrendCaveatNote } from "./TrendCaveatNote";
import { trendCaveat } from "./trendCaveats";
import { UnitText } from "../snapshot/UnitText";
import type { TrendSummary } from "./trends";

type TrendBlockProps = {
  variableId: string;
  trend: TrendSummary | null | undefined;
  signal: TrendSignal | undefined;
};

export function TrendBlock({ variableId, trend, signal }: TrendBlockProps) {
  const { t, settings, voice } = useI18n();
  const caveat = trend ? trendCaveat(variableId, voice) : null;
  const definition = settings.definitions
    ? variableDefinition(variableId, voice)
    : null;
  const full = trend ? (
    <p className="trend">
      <UnitText text={trend.headline} />
      <span>
        {trend.significance}
        {trend.period ? ` · ${trend.period}` : ""}
      </span>
    </p>
  ) : null;
  if (settings.fullStatistics) {
    return (
      <>
        {definition ? <p className="trend-definition">{definition}</p> : null}
        {full}
        {caveat ? <TrendCaveatNote caveat={caveat} /> : null}
      </>
    );
  }
  // Plain: the label, with the rounded change where the test supports one.
  const supported =
    signal &&
    !signal.unreliable &&
    (signal.state === "rising" || signal.state === "falling");
  return (
    <>
      {definition ? <p className="trend-definition">{definition}</p> : null}
      {signal && trend ? (
        <p className="trend trend-plain">
          {trendLabel(signal, "general")}
          {supported && trend.plain ? (
            <span>
              <UnitText text={trend.plain} />
            </span>
          ) : null}
        </p>
      ) : null}
      {caveat ? (
        <p className="trend-caveat-line" role="note">
          {caveat.summary}
        </p>
      ) : null}
      {trend ? (
        <details className="trend-details">
          <summary>{t("common.action.details")}</summary>
          {settings.definitions ? null : (
            <p className="trend-definition">
              {variableDefinition(variableId, "general")}
            </p>
          )}
          {full}
          {caveat ? (
            <>
              <p className="trend-definition">{caveat.details}</p>
              <p className="trend-definition">
                {t("caveats.sources", { sources: caveat.sources })}
              </p>
            </>
          ) : null}
        </details>
      ) : null}
    </>
  );
}
