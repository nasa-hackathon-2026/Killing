// Optional query parameters that set the starting view, so a view can be
// linked to or captured: ?layers=omi_no2,omi_o3 and ?closeup=omi_no2.
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
