// "On the globe" as a section of the right drawer: its title and a fold
// button, then the mode menu (and the model menu of "Model vs station") and
// the panel with the legend, the table and the sentence of the shown result.
// Folded, the title names the mode that is drawn on the globe.
import { useState } from "react";
import { useI18n } from "../i18n";
import { GlobeStatsControls } from "./GlobeStatsControls";
import { GlobeStatsPanel } from "./GlobeStatsPanel";
import { GLOBE_STATS_TEXT as T, modeLabel } from "./globeStatsText";
import type { GlobeStatsState } from "./useGlobeStats";

type GlobeStatsSectionProps = {
  state: GlobeStatsState;
  defaultOpen?: boolean;
};

export function GlobeStatsSection({
  state,
  defaultOpen = true,
}: GlobeStatsSectionProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  if (state.hidden) return null;
  return (
    <section
      className="drawer-section globe-stats-section"
      aria-label={T.overlayLabel}
    >
      <p className="drawer-section-title">
        <span>
          {open
            ? T.controlLabel
            : t("globeStats.sectionFolded", {
                title: T.controlLabel,
                mode: modeLabel(state.mode),
              })}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(
            open ? "globeStats.sectionCollapse" : "globeStats.sectionExpand",
          )}
          onClick={() => setOpen(!open)}
        >
          {open ? "–" : "+"}
        </button>
      </p>
      {open ? (
        <>
          <div className="globe-stats-selectors">
            <GlobeStatsControls state={state} />
          </div>
          <GlobeStatsPanel state={state} />
        </>
      ) : null}
    </section>
  );
}
