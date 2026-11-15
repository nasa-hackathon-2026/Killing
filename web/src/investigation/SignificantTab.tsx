// ④ Is the change significant? The linear test and the three Mann-Kendall
// tests side by side with the same lights, whether they agree, the note
// that "not significant" is not "no change", the FDR family, and for
// researchers the residual diagnostics, the download and the methods.
import { useMemo, type ReactNode } from "react";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendCaveat } from "../analysis/trendCaveats";
import { formatChangePerDecade, type AnalyzedTrend } from "../analysis/trends";
import { formatCount, localNumber, t, useI18n } from "../i18n";
import { UnitText } from "../snapshot/UnitText";
import { formatP } from "../timeline/seriesMath";
import { BarChart, EvidenceChart, TimeChart } from "./charts";
import { Fold, ReadingNote } from "./Fold";
import { recordYears } from "./format";
import type { SeriesModel } from "./InvestigationPanel";
import { agreement, verdictOf, type FdrFamily, type Verdict } from "./logic";
import {
  autocorrelation,
  outlierIndices,
  pStrength,
  residuals,
  robustSd,
  seriesCsv,
  whiteNoiseBound,
} from "./stats";

const P_CAP = 6;

const REPO =
  "https://github.com/nasa-hackathon-2026/earth-system-trend-detective";

function Light({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`investigation-light investigation-light-${verdict}`}>
      <i aria-hidden="true" />
      {t(`investigation.significant.light.${verdict}`)}
    </span>
  );
}

function TestRow({
  label,
  test,
}: {
  label: string;
  test: {
    p: number | null;
    p_fdr: number | null;
    significant: boolean | null;
    significant_fdr: boolean | null;
  };
}) {
  return (
    <li>
      <strong>{label}</strong>
      <span>
        {t("investigation.significant.pq", {
          p: formatP(test.p),
          q: formatP(test.p_fdr),
        })}
      </span>
      <Light verdict={verdictOf(test)} />
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <strong>{label}</strong>
      <span>{children}</span>
    </li>
  );
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SignificantTab({
  model,
  variableId,
  variableName,
  locationName,
  family,
}: {
  model: SeriesModel;
  variableId: string;
  variableName: string;
  locationName: string;
  family: FdrFamily | null;
}) {
  const { voice } = useI18n();
  const analyzed: AnalyzedTrend | null =
    model.trend?.status === "analyzed" ? model.trend : null;
  const caveat = trendCaveat(variableId, voice);
  const residual = useMemo(
    () =>
      analyzed
        ? residuals(
            model.anomalies,
            model.months,
            analyzed.ols.slope_per_decade,
          )
        : [],
    [analyzed, model.anomalies, model.months],
  );
  const outliers = useMemo(() => outlierIndices(residual), [residual]);
  const spread = useMemo(() => robustSd(residual), [residual]);
  const acf = useMemo(() => autocorrelation(residual, 24), [residual]);
  if (!analyzed) {
    return caveat ? <TrendCaveatNote caveat={caveat} /> : null;
  }
  const ols = analyzed.ols;
  const mk = analyzed.mann_kendall;
  const agree = agreement(analyzed);
  const used = residual.filter((value) => value !== null).length;
  const bound = whiteNoiseBound(used);
  const fileKey = model.key;

  return (
    <>
      {model.unreliable && caveat ? <TrendCaveatNote caveat={caveat} /> : null}
      <EvidenceChart
        cap={P_CAP}
        alpha={model.alpha}
        alphaLabel={`p = ${localNumber(String(model.alpha))}`}
        rows={(
          [
            ["ttest", ols],
            ["original", mk.original],
            ["hamedRao", mk.hamed_rao],
            ["seasonal", mk.seasonal],
          ] as const
        ).map(([id, test]) => ({
          label: t(`investigation.significant.rows.${id}`),
          p: pStrength(test.p, P_CAP),
          q: pStrength(test.p_fdr, P_CAP),
        }))}
        ariaLabel={t("investigation.significant.chartAria", {
          ols: formatP(ols.p),
          original: formatP(mk.original.p),
          hamedRao: formatP(mk.hamed_rao.p),
          seasonal: formatP(mk.seasonal.p),
        })}
      />
      <p className="timeline-chart-note">
        <i className="timeline-key investigation-key-p" />
        {t("investigation.significant.chartKeyP")}{" "}
        <i className="timeline-key investigation-key-q" />
        {t("investigation.significant.chartKeyQ")}{" "}
        {t("investigation.significant.chartKeyZone", {
          alpha: localNumber(String(model.alpha)),
        })}
      </p>
      <div
        className="investigation-evidence"
        role="group"
        aria-label={t("investigation.significant.evidenceAria")}
      >
        <div>
          <h4 className="investigation-subtitle">
            {t("investigation.significant.olsTitle")}
          </h4>
          <ul className="investigation-tests">
            <TestRow
              label={t("investigation.significant.rows.ttest")}
              test={ols}
            />
            <Fact label={t("investigation.significant.rows.neff")}>
              {ols.n_effective === undefined
                ? t("common.status.notAvailable")
                : formatCount(Math.round(ols.n_effective))}{" "}
              / {formatCount(analyzed.data.n_valid)}
            </Fact>
            <Fact label={t("investigation.significant.rows.r1")}>
              {ols.lag1_autocorrelation === undefined
                ? t("common.status.notAvailable")
                : localNumber(ols.lag1_autocorrelation.toFixed(2))}
            </Fact>
          </ul>
        </div>
        <div>
          <h4 className="investigation-subtitle">
            {t("investigation.significant.mkTitle")}
          </h4>
          <ul className="investigation-tests">
            <TestRow
              label={t("investigation.significant.rows.original")}
              test={mk.original}
            />
            <TestRow
              label={t("investigation.significant.rows.hamedRao")}
              test={mk.hamed_rao}
            />
            <TestRow
              label={t("investigation.significant.rows.seasonal")}
              test={mk.seasonal}
            />
            <Fact label={t("investigation.significant.rows.sen")}>
              <UnitText
                text={formatChangePerDecade(
                  analyzed.sen.slope_per_decade,
                  analyzed.sen.ci_per_decade,
                  analyzed.unit,
                  model.alpha,
                )}
              />
            </Fact>
          </ul>
        </div>
      </div>
      <p
        className={`investigation-agreement investigation-agreement-${agree}`}
        role="note"
      >
        {t(`investigation.significant.agreement.${agree}`)}
      </p>
      <ReadingNote>
        {t("investigation.significant.agreementBasis", {
          alpha: localNumber(String(model.alpha)),
        })}
      </ReadingNote>
      {!ols.significant ? (
        <p className="investigation-not-significant">
          {t("investigation.significant.notSignificantNote", {
            years: recordYears(analyzed),
            months: formatCount(analyzed.data.n_valid),
          })}
        </p>
      ) : null}
      {!model.unreliable && caveat ? <TrendCaveatNote caveat={caveat} /> : null}
      <Fold summary={t("common.action.details")} student>
        {family ? (
          <p className="timeline-chart-note">
            {t("investigation.significant.fdr", {
              n: formatCount(family.size),
              family: t(`investigation.significant.family.${family.scope}`),
            })}
          </p>
        ) : null}
        <p className="timeline-chart-note">
          {t("investigation.significant.pSource")}
        </p>
      </Fold>
      <Fold summary={t("investigation.diag.more")}>
        <h4 className="investigation-subtitle">
          {t("investigation.diag.residualTitle")}
        </h4>
        <TimeChart
          months={model.months}
          values={residual}
          marks={outliers}
          guides={spread > 0 ? [3 * spread, -3 * spread] : []}
          height={150}
          ariaLabel={t("investigation.diag.residualAria", {
            name: variableName,
            place: locationName,
            n: outliers.length,
          })}
        />
        <p className="timeline-chart-note">
          {t("investigation.diag.residualKey", { n: outliers.length })}
        </p>
        <h4 className="investigation-subtitle">
          {t("investigation.diag.acfTitle")}
        </h4>
        <BarChart
          bars={acf.map((value, at) => ({
            key: at + 1,
            value,
            label: String(at + 1),
          }))}
          limits={[bound, -bound]}
          reference={
            ols.lag1_autocorrelation === undefined
              ? null
              : { at: 0, value: ols.lag1_autocorrelation }
          }
          labelEvery={3}
          ariaLabel={t("investigation.diag.acfAria", {
            here: localNumber((acf[0] ?? 0).toFixed(2)),
          })}
        />
        <p className="timeline-chart-note">
          <i className="timeline-key investigation-key-reference" />
          {t("investigation.diag.acfKey", {
            file:
              ols.lag1_autocorrelation === undefined
                ? t("common.status.notAvailable")
                : localNumber(ols.lag1_autocorrelation.toFixed(3)),
            here: localNumber((acf[0] ?? 0).toFixed(3)),
          })}
        </p>
        <p className="timeline-chart-note">{t("investigation.diag.acfNote")}</p>
        <div className="investigation-downloads">
          <button
            type="button"
            onClick={() =>
              download(
                `${fileKey}.csv`,
                seriesCsv({
                  months: model.months,
                  values: model.raw,
                  anomalies: model.anomalies,
                  coverage: model.coverage,
                }),
                "text/csv",
              )
            }
          >
            {t("investigation.diag.downloadCsv")}
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                `${fileKey}.trend.json`,
                `${JSON.stringify({ key: fileKey, ...analyzed }, null, 2)}\n`,
                "application/json",
              )
            }
          >
            {t("investigation.diag.downloadJson")}
          </button>
        </div>
        <details className="timeline-details investigation-fold">
          <summary>{t("investigation.diag.methods")}</summary>
          <ul className="investigation-methods">
            {["anomaly", "ols", "mk", "fdr", "missing", "cleaning"].map(
              (id) => (
                <li key={id}>{t(`investigation.diag.method.${id}`)}</li>
              ),
            )}
            <li>
              <a href={`${REPO}/tree/main/docs/adr`}>docs/adr</a> ·{" "}
              <a href={`${REPO}/tree/main/docs/data`}>docs/data</a>
            </li>
          </ul>
        </details>
      </Fold>
    </>
  );
}
