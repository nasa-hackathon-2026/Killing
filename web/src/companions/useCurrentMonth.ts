// Thin adapter between the companions and "which month is shown": the
// timeline context (src/timeline/TimelineContext.tsx) is the single source.
// Companions read the month only through this hook, so it must be called
// inside <TimelineProvider>.
import { useTimeline } from "../timeline/TimelineContext";

export type CurrentMonth = {
  // "YYYY-MM-01" or null while there are no months.
  month: string | null;
  // True while the timeline is playing: companions keep changing shape but
  // do not speak until it pauses.
  playing: boolean;
};

export function useCurrentMonth(): CurrentMonth {
  const { month, playing } = useTimeline();
  return { month, playing };
}
