import { layerRegistry } from "../layers/registry";
import { monthName, useI18n } from "../i18n";
import { variableName } from "../i18n/names";
import { useTimeline } from "../timeline/TimelineContext";
import { calendarMonth } from "./fieldMapping";
import { resolveField, useFieldMode } from "./fieldStore";
import { fieldText } from "./fieldText";
import { useField } from "./loadField";

export function useFieldNote(openIds: readonly string[]): string | null {
  const { locale } = useI18n();
  const mode = useFieldMode();
  const timeline = useTimeline();
  const id = resolveField(mode, timeline.selectedVariableId, openIds);
  const month = calendarMonth(timeline.month);
  const state = useField(id);
  if (id === null || month === null || state.status !== "ready") return null;
  const fallback = layerRegistry.find((layer) => layer.id === id)?.nameEn ?? id;
  const name = variableName(id, fallback).toLocaleLowerCase(locale);
  const shownMonth = monthName(`2000-${String(month + 1).padStart(2, "0")}`);
  return fieldText.particleNote(shownMonth, name);
}
