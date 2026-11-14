// Optional query parameters that set the starting view, so a view can be
// linked to or captured: ?layers=omi_no2,omi_o3, ?closeup=omi_no2 and
// ?trendmap=gldas_tair (the global trend map of one variable).
function param(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function requestedLayers(): string[] | null {
  const value = param("layers");
  if (value === null) return null;
  return value.split(",").filter((item) => item.length > 0);
}

export function requestedCloseUp(): string | null {
  return param("closeup");
}

export function requestedTrendMap(): string | null {
  return param("trendmap");
}
