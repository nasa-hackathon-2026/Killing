import { useState } from "react";
import { useI18n } from "../i18n";
import { formatSigned } from "../analysis/modelVsObs";
import { UnitText } from "../snapshot/UnitText";
import { GLOBE_STATS_TEXT as T } from "./globeStatsText";
import type { GlobeStatsState } from "./useGlobeStats";
import { countGlyphs } from "./trendGlyphs";
import "./globeStats.css";

function PlaceButton({
  state,
  id,
  name,
}: {
  state: GlobeStatsState;
  id: string;
  name: string;
}) {
  return state.places.some((place) => place.id === id) ? (
    <button
      type="button"
      className="globe-stats-place"
      onClick={() => state.onSelectLocation(id)}
    >
      {name}
    </button>
  ) : (
    <span>{name}</span>
  );
}

function TrendLegend({ state }: { state: GlobeStatsState }) {
  const counts = countGlyphs(state.trendGlyphs);
  return (
    <>
      <p>{T.trendIntro}</p>
      <p>{T.trendLength}</p>
      <p>{T.trendLengthScale}</p>
      <ul className="globe-stats-key">
        <li>
          <span className="globe-key-mark globe-key-solid" aria-hidden="true">
            ↑
          </span>
          {T.trendSolid} ({counts.solidUp + counts.solidDown})
        </li>
        <li>
          <span className="globe-key-mark globe-key-hollow" aria-hidden="true">
            ↑
          </span>
          {T.trendHollow} ({counts.hollow})
        </li>
        <li>
          <span
            className="globe-key-mark globe-key-unreliable"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                d="M12 3 22 21H2Z M3 22 21 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </span>
          {T.trendUnreliable} ({counts.unreliable})
        </li>
        <li>
          <span className="globe-key-mark globe-key-nodata" aria-hidden="true">
            ●
          </span>
          {T.trendNoData} ({counts.nodata})
        </li>
      </ul>
    </>
  );
}

function GapLegend() {
  return (
    <>
      <p>{T.gapIntro}</p>
      <p>{T.gapModelSelect}</p>
      <ul className="globe-stats-key">
        <li>{T.gapHalves}</li>
        <li>{T.gapRing}</li>
        <li>{T.gapObsWarn}</li>
        <li>{T.gapModelStripes}</li>
      </ul>
      <p className="globe-stats-note">{T.gapOnlyTemperature}</p>
    </>
  );
}

function AlikeLegend() {
  return (
    <>
      <p>{T.alikeIntro}</p>
      <ul className="globe-stats-key">
        <li>{T.alikeWidth}</li>
        <li>{T.alikeColour}</li>
        <li>{T.alikeDashed}</li>
      </ul>
      <p className="globe-stats-note">{T.alikeNotCause}</p>
      <p className="globe-stats-note">{T.alikeSource}</p>
      <p className="globe-stats-note">{T.alikeGlobal}</p>
    </>
  );
}

function TrendTable({ state }: { state: GlobeStatsState }) {
  return (
    <div className="globe-stats-table-scroll">
      <table>
        <caption>{T.tableTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{T.columnPlace}</th>
            <th scope="col">{T.columnChange}</th>
            <th scope="col">{T.columnSignificance}</th>
            <th scope="col">{T.columnReliability}</th>
          </tr>
        </thead>
        <tbody>
          {state.trendGlyphs.map((glyph) => (
            <tr key={glyph.placeId}>
              <td>
                <PlaceButton
                  state={state}
                  id={glyph.placeId}
                  name={glyph.placeName}
                />
              </td>
              <td>{glyph.changeText || T.noResult}</td>
              <td>{glyph.significanceText}</td>
              <td>{glyph.reliabilityText || T.noResult}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GapTable({ state }: { state: GlobeStatsState }) {
  return (
    <div className="globe-stats-table-scroll">
      <table>
        <caption>{T.tableTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{T.columnPlace}</th>
            <th scope="col">{T.columnModel}</th>
            <th scope="col">{T.columnStation}</th>
            <th scope="col">{T.columnCorrelation}</th>
            <th scope="col">{T.columnMonths}</th>
            <th scope="col">{T.columnWarning}</th>
          </tr>
        </thead>
        <tbody>
          {state.gapGlyphs.map((glyph) => (
            <tr key={glyph.pairId}>
              <td>
                <PlaceButton
                  state={state}
                  id={glyph.placeId}
                  name={glyph.placeName}
                />
              </td>
              <td>
                <UnitText
                  text={`${formatSigned(glyph.modelSlope)} ${glyph.unit} ${T.perDecade}`}
                />
              </td>
              <td>
                <UnitText
                  text={`${formatSigned(glyph.observationSlope)} ${glyph.unit} ${T.perDecade}`}
                />
              </td>
              <td>{formatSigned(glyph.correlation)}</td>
              <td>{glyph.commonMonths}</td>
              <td>
                {glyph.modelUnreliable ? T.model : ""}
                {glyph.modelUnreliable && glyph.observationUnreliable
                  ? "; "
                  : ""}
                {glyph.observationUnreliable ? T.station : ""}
                {!glyph.modelUnreliable && !glyph.observationUnreliable
                  ? T.no
                  : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlikeTable({ state }: { state: GlobeStatsState }) {
  return (
    <div className="globe-stats-table-scroll">
      <table>
        <caption>{T.tableTitle}</caption>
        <thead>
          <tr>
            <th scope="col">{T.columnPlace}</th>
            <th scope="col">{T.columnOther}</th>
            <th scope="col">{T.columnSimilarity}</th>
            <th scope="col">{T.columnDetrended}</th>
            <th scope="col">{T.columnDashed}</th>
          </tr>
        </thead>
        <tbody>
          {state.alikeArcs.map((arc) => (
            <tr key={arc.seriesKey}>
              <td>
                <PlaceButton
                  state={state}
                  id={arc.targetLocationId}
                  name={arc.targetName}
                />
                {arc.samePlace ? ` (${T.alikeSamePlace})` : ""}
                {arc.targetLat === null ? ` (${T.alikeGlobal})` : ""}
              </td>
              <td>{arc.targetVariableName}</td>
              <td>{formatSigned(arc.cosine)}</td>
              <td>{formatSigned(arc.detrendedCosine)}</td>
              <td>{arc.dashed ? T.yes : T.no}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function dataStatus(state: GlobeStatsState): string | null {
  if (state.mode === "trend") {
    if (!state.selectedVariableId) return T.needVariable;
    if (state.trends.status === "loading") return T.loading;
    if (state.trends.status === "error") return T.loadError;
    return state.trendGlyphs.length === 0 ? T.noResult : null;
  }
  if (state.mode === "gap") {
    if (state.modelVsObs.status === "loading") return T.loading;
    if (state.modelVsObs.status === "error") return T.loadError;
    return state.gapGlyphs.length === 0 ? T.gapNoPairs : null;
  }
  if (!state.selectedVariableId) return T.needVariable;
  if (!state.places.some((place) => place.id === state.selectedLocationId)) {
    return T.alikeGlobal;
  }
  if (state.similarSeries.status === "loading") return T.loading;
  if (state.similarSeries.status === "error") return T.loadError;
  return state.alikeArcs.length === 0 ? T.alikeNone : null;
}

// The one line shown while the legend is collapsed.
function shortKey(mode: GlobeStatsState["mode"]): string {
  if (mode === "trend") return T.trendKeyShort;
  if (mode === "gap") return T.gapHalves;
  return T.alikeColour;
}

export function GlobeStatsPanel({ state }: { state: GlobeStatsState }) {
  const { role } = useI18n();
  // Collapsed by default: the selector above and one line of key, so the
  // panel does not cover the globe or the selected place.
  const [legendOpen, setLegendOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  if (state.hidden || state.legendHidden || state.mode === "none") return null;
  const notice = dataStatus(state);

  return (
    <aside className="globe-stats-panel" aria-label={T.overlayLabel}>
      <header className="globe-stats-header">
        {/* Everyone: the selector above already names the mode. */}
        {role === "everyone" ? null : (
          <strong>
            {
              T[
                `mode${state.mode[0]?.toUpperCase()}${state.mode.slice(1)}` as keyof typeof T
              ]
            }
          </strong>
        )}
        <div>
          <button
            type="button"
            aria-expanded={legendOpen}
            onClick={() => setLegendOpen((open) => !open)}
          >
            {legendOpen ? T.legendHide : T.legendShow}
          </button>
          <button
            type="button"
            aria-expanded={tableOpen}
            onClick={() => setTableOpen((open) => !open)}
          >
            {tableOpen ? T.tableHide : T.tableShow}
          </button>
        </div>
      </header>
      <p className="globe-stats-note">
        {state.mode === "gap"
          ? state.modelVariables.find(
              (item) => item.id === state.modelVariableId,
            )?.name
          : state.selectedVariableName}
        {state.mode === "alike" ? ` · ${state.selectedLocationName}` : ""}
      </p>
      {legendOpen ? null : (
        <p className="globe-stats-short">{shortKey(state.mode)}</p>
      )}
      {legendOpen ? (
        <div className="globe-stats-legend">
          {state.mode === "trend" ? <TrendLegend state={state} /> : null}
          {state.mode === "gap" ? <GapLegend /> : null}
          {state.mode === "alike" ? <AlikeLegend /> : null}
        </div>
      ) : null}
      {notice ? <p className="globe-stats-note">{notice}</p> : null}
      {tableOpen ? (
        <section className="globe-stats-table" aria-label={T.tableTitle}>
          {state.mode === "trend" ? <TrendTable state={state} /> : null}
          {state.mode === "gap" ? <GapTable state={state} /> : null}
          {state.mode === "alike" ? <AlikeTable state={state} /> : null}
        </section>
      ) : null}
    </aside>
  );
}
