// Where the speech bubble of a companion goes, so it points at the companion
// and stays inside the window. Pure.

export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };

export type BubbleSide = "left" | "right" | "top" | "bottom";

export type BubblePlacement = {
  left: number;
  top: number;
  // The side of the companion the bubble is on.
  side: BubbleSide;
  // Where the tail is along the bubble's edge facing the companion, in px
  // from the bubble's top (left or right side) or left (top or bottom side).
  tail: number;
};

export const BUBBLE_MARGIN = 12;
export const BUBBLE_GAP = 12;
// The tail stays this far from the corners.
const TAIL_INSET = 18;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

// Tries the left of the companion first (the sidebar is at the right edge, so
// there is room towards the globe), then right, above and below; the first
// that fits in the window wins. When none does (a phone), the bubble goes
// below, pushed inside the window.
export function placeBubble(
  anchor: Rect,
  size: Size,
  viewport: Size,
  margin = BUBBLE_MARGIN,
  gap = BUBBLE_GAP,
): BubblePlacement {
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  const fitsLeft = anchor.left - gap - size.width >= margin;
  const fitsRight =
    anchor.left + anchor.width + gap + size.width <= viewport.width - margin;
  const fitsTop = anchor.top - gap - size.height >= margin;
  const fitsBottom =
    anchor.top + anchor.height + gap + size.height <= viewport.height - margin;

  const beside = (side: "left" | "right"): BubblePlacement => {
    const top = clamp(
      centerY - size.height / 2,
      margin,
      viewport.height - size.height - margin,
    );
    return {
      left:
        side === "left"
          ? anchor.left - gap - size.width
          : anchor.left + anchor.width + gap,
      top,
      side,
      tail: clamp(centerY - top, TAIL_INSET, size.height - TAIL_INSET),
    };
  };
  const above = (side: "top" | "bottom"): BubblePlacement => {
    const left = clamp(
      centerX - size.width / 2,
      margin,
      viewport.width - size.width - margin,
    );
    return {
      left,
      top:
        side === "top"
          ? anchor.top - gap - size.height
          : anchor.top + anchor.height + gap,
      side,
      tail: clamp(centerX - left, TAIL_INSET, size.width - TAIL_INSET),
    };
  };

  if (fitsLeft) return beside("left");
  if (fitsRight) return beside("right");
  if (fitsTop) return above("top");
  if (fitsBottom) return above("bottom");
  const fallback = above("bottom");
  return {
    ...fallback,
    top: clamp(fallback.top, margin, viewport.height - size.height - margin),
  };
}
