import { layerRegistry } from "../layers/registry";
import { useTimeline } from "../timeline/TimelineContext";
import { calendarMonth } from "./fieldMapping";
import { resolveField, useFieldMode } from "./fieldStore";
import { MONTH_NAMES, fieldText } from "./fieldText";
import { useField } from "./loadField";

export function useFieldNote(openIds: readonly string[]): string | null {
  const mode = useFieldMode();
  const timeline = useTimeline();
  const id = resolveField(mode, timeline.selectedVariableId, openIds);
  const month = calendarMonth(timeline.month);
  const state = useField(id);
  if (id === null || month === null || state.status !== "ready") return null;
  const name = layerRegistry.find((layer) => layer.id === id)?.nameEn ?? id;
  return fieldText.particleNote(MONTH_NAMES[month], name.toLowerCase());
}
