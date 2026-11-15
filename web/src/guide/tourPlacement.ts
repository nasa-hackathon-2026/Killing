// Where the tour's bubble goes: among a few candidate spots, the one that
// covers the step's own regions least, then the other panels least. Pure,
// so it is tested without a page.
export type Box = { left: number; top: number; width: number; height: number };
export type Placement = { left: number; top: number };

type PlacementInput = {
  bubble: { width: number; height: number };
  viewport: { width: number; height: number };
  // Regions the step talks about: never covered if any spot avoids them.
  targets: Box[];
  // Other panels: covered as little as possible.
  panels: Box[];
  // Top of the free area (below the top bar).
  top: number;
  margin: number;
};

// How much more a covered target counts than a covered panel.
const TARGET_WEIGHT = 50;
// Any overlap with a target at all, so a sliver still counts.
const TARGET_PENALTY = 1e9;

function overlap(a: Box, b: Box): number {
  const width =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const height =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

export function bubblePlacement(input: PlacementInput): Placement {
  const { bubble, viewport, margin } = input;
  const maxLeft = Math.max(margin, viewport.width - bubble.width - margin);
  const maxTop = Math.max(input.top, viewport.height - bubble.height - margin);
  const lefts = [
    (viewport.width - bubble.width) / 2,
    margin,
    viewport.width - bubble.width - margin,
    // Centred in the widest gap between targets and panels, horizontally.
    ...[...input.targets, ...input.panels].flatMap((box) => [
      box.left + box.width + margin,
      box.left - bubble.width - margin,
    ]),
  ];
  const tops = [
    input.top,
    (viewport.height - bubble.height) / 2,
    viewport.height - bubble.height - margin,
    ...[...input.targets, ...input.panels].flatMap((box) => [
      box.top + box.height + margin,
      box.top - bubble.height - margin,
    ]),
  ];
  let best: Placement = {
    left: clamp(lefts[0] ?? margin, margin, maxLeft),
    top: input.top,
  };
  let bestScore = Infinity;
  // Candidates in order of preference: the first of equal scores wins.
  for (const top of tops) {
    for (const left of lefts) {
      const spot = {
        left: clamp(left, margin, maxLeft),
        top: clamp(top, input.top, maxTop),
      };
      const box = { ...spot, ...bubble };
      const score =
        input.targets.reduce((sum, target) => {
          const area = overlap(box, target);
          return area > 0 ? sum + TARGET_PENALTY + TARGET_WEIGHT * area : sum;
        }, 0) +
        input.panels.reduce((sum, panel) => sum + overlap(box, panel), 0);
      if (score < bestScore - 1) {
        best = spot;
        bestScore = score;
      }
    }
  }
  return best;
}
