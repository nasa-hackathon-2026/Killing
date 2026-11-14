// The month the layer view shows.
//
// ADAPTER: today the month comes from the Month slider state that App.tsx
// owns and passes down. Once the timeline (web/src/timeline/TimelineContext)
// is merged, change the body to
//   const { month } = useTimeline();
//   return month ?? appMonth;
// and the layer view follows the timeline's playback with no other change.
export function useCurrentMonth(appMonth: string | null): string | null {
  return appMonth;
}
