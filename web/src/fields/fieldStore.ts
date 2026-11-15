// Which global distribution is on, shared by the control (FieldToggle, in
// the page) and the dots (GlobalField, inside the canvas) without threading
// state through App. Starts from ?field= (urlParams.ts) or DEFAULT_FIELD.

import { useSyncExternalStore } from "react";
import { requestedField } from "../urlParams";
import { DEFAULT_FIELD, fieldVariable, type FieldMode } from "./fieldConfig";

// "?field=auto", "?field=<id with a grid>" or "?field=off"; anything else
// falls back to DEFAULT_FIELD.
export function parseFieldParam(value: string | null): FieldMode {
  if (value === null) return DEFAULT_FIELD;
  if (value === "off" || value === "") return null;
  if (value === "auto") return "auto";
  return fieldVariable(value) ? value : DEFAULT_FIELD;
}

// The variable drawn: an explicit id as is; "auto" follows the time series
// chart when its variable has a grid, else the first open layer with one.
export function resolveField(
  mode: FieldMode,
  chartId: string | null,
  openIds: readonly string[],
): string | null {
  if (mode === null) return null;
  if (mode !== "auto") return fieldVariable(mode) ? mode : null;
  if (fieldVariable(chartId)) return chartId;
  return openIds.find((id) => fieldVariable(id)) ?? null;
}

let mode: FieldMode = parseFieldParam(requestedField());
const listeners = new Set<() => void>();

export function setFieldMode(next: FieldMode): void {
  if (next === mode) return;
  mode = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFieldMode(): FieldMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => mode,
  );
}
