// Optional query parameters that set the starting view, so a view can be
// linked to or captured: ?layers=omi_no2,omi_o3 (read by startingLayers in
// guide/firstVisit.ts, which also sets the first-visit defaults), ?closeup=omi_no2 and
// ?trendmap=gldas_tair (the global trend map of one variable). The timeline
// reads ?month=2015-07 (the month shown), ?play=1 (start playing) and
// ?chart=gldas_tair (the variable in the time series chart).
// ?strata=1&at=taipei opens the layer view at a place (`at` is optional).
// ?field=imerg_precip (or auto, or off) turns on the global distribution
// (web/src/fields).
function param(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function requestedCloseUp(): string | null {
  return param("closeup");
}

export function requestedTrendMap(): string | null {
  return param("trendmap");
}

export function requestedMonth(): string | null {
  return param("month");
}

export function requestedPlay(): boolean {
  return param("play") === "1";
}

export function requestedChart(): string | null {
  return param("chart");
}

export function requestedStrata(): boolean {
  return param("strata") === "1";
}

export function requestedPlace(): string | null {
  return param("at");
}

export function requestedField(): string | null {
  return param("field");
}
