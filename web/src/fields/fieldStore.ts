// The global distribution is part of the global trend map (#197): there is
// one control, and the variable of the trend map is the variable of the dots.
// The old ?field=<id> still opens the map of that variable (see
// initialTrendMapId in App); this file only reads it.

import { requestedField } from "../urlParams";
import { fieldVariable } from "./fieldConfig";

// "?field=<id with a grid>" → that id; "off", "auto" (which followed the
// chart or an open layer, now gone) and anything else → null.
export function parseFieldParam(value: string | null): string | null {
  if (value === null || value === "off" || value === "" || value === "auto") {
    return null;
  }
  return fieldVariable(value) ? value : null;
}

export function requestedFieldVariable(): string | null {
  return parseFieldParam(requestedField());
}
