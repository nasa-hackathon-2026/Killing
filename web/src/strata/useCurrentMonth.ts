// The month the layer view shows: the timeline's month, so the view follows
// playback. `appMonth` (what AppView passes down) is only the fallback while
// the timeline has no months yet. Must be called inside <TimelineProvider>.
import { useTimeline } from "../timeline/TimelineContext";

export function useCurrentMonth(appMonth: string | null): string | null {
  const { month } = useTimeline();
  return month ?? appMonth;
}
