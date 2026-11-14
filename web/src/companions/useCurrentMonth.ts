// A 合併後改成 `useTimeline()`（web/src/timeline/TimelineContext.tsx）：
// 這個 hook 是唯一要改的地方，回傳的欄位不變。
//
// Thin adapter between the companions and "which month is shown". Today the
// month lives in App.tsx state (the Month slider of the layer panel) and is
// passed in; there is no playback yet, so `playing` is always false.
export type CurrentMonth = {
  // "YYYY-MM-DD" (first of the month) or null before the snapshot loads.
  month: string | null;
  // True while a timeline is playing: companions keep changing shape but do
  // not speak until it pauses.
  playing: boolean;
};

export function useCurrentMonth(appMonth: string | null): CurrentMonth {
  return { month: appMonth, playing: false };
}
