// The line under the timeline that says what the particles are: one value
// per layer, at the selected place and month. They cover the whole globe, so
// without it they read as a global map. Pure; the wording follows the Layers
// panel ("Values at <place>").
import { calmText, fillCalmText } from "../forms/calm/calmText";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export type ParticleNoteInput = {
  // English names of the layers that are switched on.
  layerNames: string[];
  place: string;
  // "YYYY-MM" or "YYYY-MM-DD"; null when no month is selected.
  month: string | null;
  // The global trend map is drawn on the globe.
  trendMap: boolean;
  // "calm": the layers are clusters above the place (forms/calm). Anything
  // else is the original wording.
  style?: "calm" | "lively";
};

// Null when no layer is on: there are no particles to explain.
export function particleNote(input: ParticleNoteInput): string | null {
  if (input.layerNames.length === 0) return null;
  const trendMapNote = input.trendMap
    ? " The coloured map is a map: per-grid-cell trend."
    : "";
  if (input.style === "calm") {
    const month = input.month
      ? MONTHS[Number(input.month.slice(5, 7)) - 1]
      : undefined;
    return (
      fillCalmText(
        input.layerNames.length === 1
          ? calmText.noteOneLayer
          : calmText.noteManyLayers,
        {
          place: input.place,
          layer: input.layerNames[0] ?? "",
          when:
            input.month && month ? `, ${month} ${input.month.slice(0, 4)}` : "",
        },
      ) + trendMapNote
    );
  }
  const what =
    input.layerNames.length === 1
      ? `Particles show one value: ${input.layerNames[0]}`
      : "Particles show one value per layer: the selected layers";
  const name = input.month
    ? MONTHS[Number(input.month.slice(5, 7)) - 1]
    : undefined;
  const when =
    input.month && name ? `, ${name} ${input.month.slice(0, 4)}` : "";
  return `${what} at ${input.place}${when}. They are not a map.` + trendMapNote;
}
