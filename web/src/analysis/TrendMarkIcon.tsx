import { trendMark, type TrendSignal } from "../forms/encoding";

// The trend mark next to a variable's name: ▲ ▼ △ ▽ ◇ as text, and the
// "not reliable" mark as a drawn shape (a triangle outline in the direction
// of the slope with a line through it), so it does not depend on a font.
export function TrendMarkIcon({ signal }: { signal: TrendSignal }) {
  const mark = trendMark(signal);
  if (!mark.glyph) return null;
  if (!signal.unreliable) {
    return (
      <span
        className="trend-mark"
        role="img"
        aria-label={mark.label}
        title={mark.label}
      >
        {mark.glyph}
      </span>
    );
  }
  const up = signal.state === "rising";
  return (
    <span
      className="trend-mark trend-mark-unreliable"
      role="img"
      aria-label={mark.label}
      title={mark.label}
    >
      <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <polygon
          points={up ? "8,2.5 14,13 2,13" : "8,13.5 14,3 2,3"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <line
          x1="1.5"
          y1="14.5"
          x2="14.5"
          y2="1.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
