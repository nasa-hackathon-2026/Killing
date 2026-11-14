import type { TrendCaveat } from "./trendCaveats";

// A caveat next to a trend: the one-sentence caution is always visible, the
// numbers and sources open under a native <details>.
export function TrendCaveatNote({ caveat }: { caveat: TrendCaveat }) {
  return (
    <div className="trend-caveat" role="note">
      <p>{caveat.summary}</p>
      <details>
        <summary>Details</summary>
        <p>{caveat.details}</p>
        <p className="trend-caveat-sources">Sources: {caveat.sources}</p>
      </details>
    </div>
  );
}
