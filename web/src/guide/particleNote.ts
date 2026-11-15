// The line under the timeline that says what the particles are: one value
// per layer, at the selected place and month. They cover the whole globe, so
// without it they read as a global map. Pure; the wording follows the Layers
// panel ("Values at <place>").
import { calmText, fillCalmText } from "../forms/calm/calmText";
import { monthYear, t } from "../i18n";

export type ParticleNoteInput = {
  // Names of the layers that are switched on, in the active language.
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

export function particleNote(input: ParticleNoteInput): string | null {
  if (input.layerNames.length === 0) return null;
  const month = input.month ? monthYear(input.month, "short") : null;
  const where = month
    ? t("places.placeMonth", { place: input.place, month })
    : input.place;
  const what =
    input.style === "calm"
      ? fillCalmText(
          input.layerNames.length === 1
            ? calmText.noteOneLayer
            : calmText.noteManyLayers,
          {
            place: input.place,
            layer: input.layerNames[0] ?? "",
            when: month ? `, ${month}` : "",
          },
        )
      : input.layerNames.length === 1
        ? t("hud.particles.one", { layer: input.layerNames[0] ?? "", where })
        : t("hud.particles.many", { where });
  return input.trendMap ? `${what} ${t("hud.particles.trendMap")}` : what;
}
