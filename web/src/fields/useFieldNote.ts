import { layerRegistry } from "../layers/registry";
import { monthName, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { useTimeline } from "../timeline/TimelineContext";
import { calendarMonth } from "./fieldMapping";
import { fieldText } from "./fieldText";
import { useField } from "./loadField";

// The line under the timeline that says what the glowing dots show; `id` is
// the variable of the global trend map (null = off).
export function useFieldNote(id: string | null): string | null {
  const { locale } = useI18n();
  const timeline = useTimeline();
  const month = calendarMonth(timeline.month);
  const state = useField(id);
  if (id === null || month === null || state.status !== "ready") return null;
  const fallback = layerRegistry.find((layer) => layer.id === id)?.nameEn ?? id;
  const name = variableName(id, fallback).toLocaleLowerCase(locale);
  const shownMonth = monthName(`2000-${String(month + 1).padStart(2, "0")}`);
  return fieldText.particleNote(shownMonth, name);
}
