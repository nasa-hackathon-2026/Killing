import { GlobalField } from "../fields/GlobalField";
import { calendarMonth } from "../fields/fieldMapping";
import { useField } from "../fields/loadField";
import { useTimeline } from "../timeline/TimelineContext";
import type { TrendMap } from "./loadTrendMap";
import { TrendMapOverlay } from "./TrendMapOverlay";

type GlobalTrendMapProps = {
  // Variable of the map; null = off.
  id: string | null;
  // The trend map once loaded (null while it loads, or when it failed).
  map: TrendMap | null;
  opacity: number;
};

// The global trend map as one layer (#197): the coloured cells and the
// glowing dots are drawn from the same variable and both follow the
// timeline's month. Mounted inside the globe's canvas.
export function GlobalTrendMap({ id, map, opacity }: GlobalTrendMapProps) {
  const timeline = useTimeline();
  const state = useField(id);
  return (
    <>
      {map ? (
        <TrendMapOverlay
          map={map}
          opacity={opacity}
          field={state.status === "ready" ? state.field : null}
          month={calendarMonth(timeline.month)}
          speed={timeline.playing ? timeline.speed : 1}
        />
      ) : null}
      <GlobalField id={id} trendMap={map} />
    </>
  );
}
