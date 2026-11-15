// Small line icons for the top bar. Drawn here, 16 x 16, in the current text
// colour: no icon font, image file or package. They are decoration only (the
// control next to them carries the name), so they are hidden from assistive
// technology.
import type { ReactElement } from "react";

export type HudIconName =
  | "guide"
  | "layers"
  | "distribution"
  | "trend"
  | "search"
  | "language"
  | "more"
  | "fly";

const SHAPES: Record<HudIconName, ReactElement> = {
  // A question mark in a circle.
  guide: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.1 6.3a2 2 0 1 1 2.9 1.8c-.7.4-1 .8-1 1.5" />
      <path d="M8 11.7h.01" />
    </>
  ),
  // Three stacked sheets.
  layers: (
    <>
      <path d="M8 2 14 5.2 8 8.4 2 5.2z" />
      <path d="M2 8.1 8 11.3l6-3.2" />
      <path d="M2 10.9 8 14.1l6-3.2" />
    </>
  ),
  // A globe outline filled with scattered dots.
  distribution: (
    <>
      <circle cx="8" cy="8" r="6.4" opacity="0.55" />
      <g fill="currentColor" stroke="none">
        <circle cx="5.2" cy="5.4" r="1.05" />
        <circle cx="8.9" cy="4.4" r="0.9" />
        <circle cx="10.9" cy="7.3" r="1.15" />
        <circle cx="6.4" cy="8.6" r="1.2" />
        <circle cx="9.3" cy="10.8" r="0.95" />
        <circle cx="4.6" cy="11" r="0.8" />
        <circle cx="11.6" cy="10.6" r="0.7" />
      </g>
    </>
  ),
  // A globe with a rising trend line across it.
  trend: (
    <>
      <circle cx="8" cy="8" r="6.4" opacity="0.55" />
      <path d="M3.8 11 6.7 8 8.7 9.6 12.4 5.2" strokeWidth="1.7" />
      <path d="M9.6 5.1h2.9v2.9" strokeWidth="1.7" />
    </>
  ),
  // A magnifying glass.
  search: (
    <>
      <circle cx="6.8" cy="6.8" r="4.2" />
      <path d="M10 10l4 4" />
    </>
  ),
  // A globe with meridians (a language menu).
  language: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4" />
      <path d="M8 1.8c-2.1 1.9-2.1 10.5 0 12.4M8 1.8c2.1 1.9 2.1 10.5 0 12.4" />
    </>
  ),
  // Three dots.
  more: (
    <>
      <path d="M3.2 8h.01M8 8h.01M12.8 8h.01" strokeWidth="2.4" />
    </>
  ),
  // A map pin.
  fly: (
    <>
      <path d="M8 14.3C5.2 11.3 3.6 9 3.6 6.6a4.4 4.4 0 0 1 8.8 0c0 2.4-1.6 4.7-4.4 7.7z" />
      <circle cx="8" cy="6.6" r="1.6" />
    </>
  ),
};

export function HudIcon({
  name,
  size = 16,
}: {
  name: HudIconName;
  size?: number;
}) {
  return (
    <svg
      className="hud-icon"
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
