import { useEffect, useRef } from "react";

// Calls `onDismiss` after `ms` of not being held. Holding (the pointer is on
// the bubble, or focus is in it) stops the clock and keeps what is left, so
// a reader who is reading is not cut off; letting go carries on from there.
// A new `resetKey` (another companion, the caution opened) starts over.
// `active` false switches it off.
export function useDismissTimer(
  active: boolean,
  ms: number,
  held: boolean,
  onDismiss: () => void,
  resetKey: string,
): void {
  const remaining = useRef(ms);
  const started = useRef(0);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });
  useEffect(() => {
    remaining.current = ms;
  }, [resetKey, ms]);
  useEffect(() => {
    if (!active || held) return;
    started.current = performance.now();
    const timer = window.setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(
        0,
        remaining.current - (performance.now() - started.current),
      );
    };
  }, [active, held, resetKey]);
}
