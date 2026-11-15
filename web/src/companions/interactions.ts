// What two neighbouring companions do when they stand one above the other.
// The rules are data: edit this list to change or remove an interaction.
//
// These are illustrations of how the forms relate (water, heat), NOT
// findings. Nothing here reads the data, and no rule claims that one
// variable changes another; the panel says so under the companions.
import type { CompanionKind, CompanionSpec } from "./companionSpec";

// drip: a drop passes from the upper to the lower companion.
// rise: small beads pass from the lower to the upper companion.
// glow: the temperature companion's warm light falls on its neighbour.
export type InteractionEffect = "drip" | "rise" | "glow";

type Selector = { kind: CompanionKind; variant?: CompanionSpec["variant"] };

export type InteractionRule = {
  upper: Selector | "any";
  lower: Selector | "any";
  effect: InteractionEffect;
  // What the animation shows, in plain words (English; the shown text is
  // the message `companions.interactions.<key>`).
  note: string;
  key: string;
};

export const INTERACTION_RULES: InteractionRule[] = [
  {
    upper: { kind: "vapor", variant: "column" },
    lower: { kind: "water" },
    effect: "drip",
    note: "Vapor above Rain: a drop passes down.",
    key: "vaporRain",
  },
  {
    upper: { kind: "water" },
    lower: { kind: "soil" },
    effect: "drip",
    note: "Rain above Soil: a drop passes down.",
    key: "rainSoil",
  },
  {
    upper: { kind: "water" },
    lower: { kind: "plant" },
    effect: "drip",
    note: "Rain above Leaf: a drop passes down.",
    key: "rainLeaf",
  },
  {
    upper: { kind: "vapor" },
    lower: { kind: "vapor", variant: "rising" },
    effect: "rise",
    note: "Evaporation below Vapor: beads pass up.",
    key: "evaporationVapor",
  },
  {
    upper: { kind: "vapor", variant: "rising" },
    lower: { kind: "soil" },
    effect: "rise",
    note: "Soil below Evaporation: beads pass up.",
    key: "soilEvaporation",
  },
  {
    upper: { kind: "energy" },
    lower: "any",
    effect: "glow",
    note: "A temperature companion's light falls on the one below.",
    key: "glowBelow",
  },
  {
    upper: "any",
    lower: { kind: "energy" },
    effect: "glow",
    note: "A temperature companion's light falls on the one above.",
    key: "glowAbove",
  },
];

function matches(selector: Selector | "any", spec: CompanionSpec): boolean {
  if (selector === "any") return true;
  if (selector.kind !== spec.kind) return false;
  return selector.variant === undefined || selector.variant === spec.variant;
}

export type Interaction = {
  upperId: string;
  lowerId: string;
  effect: InteractionEffect;
  // For "glow": which of the two is lit.
  litId: string | null;
  note: string;
  // Message key of the note: companions.interactions.<key>.
  key: string;
};

// `ordered` is highest first (byAltitude). Each neighbouring pair gets the
// first rule that matches; two temperature companions do not light each
// other.
export function interactionsFor(ordered: CompanionSpec[]): Interaction[] {
  const result: Interaction[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const upper = ordered[index] as CompanionSpec;
    const lower = ordered[index + 1] as CompanionSpec;
    if (upper.kind === "energy" && lower.kind === "energy") continue;
    const rule = INTERACTION_RULES.find(
      (item) => matches(item.upper, upper) && matches(item.lower, lower),
    );
    if (!rule) continue;
    result.push({
      upperId: upper.id,
      lowerId: lower.id,
      effect: rule.effect,
      litId:
        rule.effect === "glow"
          ? upper.kind === "energy"
            ? lower.id
            : upper.id
          : null,
      note: rule.note,
      key: rule.key,
    });
  }
  return result;
}
