import { GLOBE_MODE_IDS } from "./globeStatsMode";
import { useI18n } from "../i18n";
import { GLOBE_STATS_TEXT as T } from "./globeStatsText";
import type { GlobeStatsState } from "./useGlobeStats";
import "./globeStats.css";

export function GlobeStatsControls({ state }: { state: GlobeStatsState }) {
  useI18n();
  if (state.hidden || state.legendHidden) return null;

  return (
    <>
      <label className="globe-stats-control">
        <span>{T.controlLabel}</span>
        <select
          aria-label={T.controlLabel}
          value={state.mode}
          onChange={(event) =>
            state.setMode(event.target.value as GlobeStatsState["mode"])
          }
        >
          {GLOBE_MODE_IDS.map((mode) => (
            <option key={mode} value={mode}>
              {
                T[
                  `mode${mode[0]?.toUpperCase()}${mode.slice(1)}` as keyof typeof T
                ]
              }
            </option>
          ))}
        </select>
      </label>
      {state.mode === "gap" ? (
        <label className="globe-stats-control">
          <span>{T.gapModelSelect}</span>
          <select
            aria-label={T.gapModelSelect}
            value={state.modelVariableId}
            onChange={(event) => state.setModelVariableId(event.target.value)}
          >
            {state.modelVariables.map((variable) => (
              <option key={variable.id} value={variable.id}>
                {variable.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
