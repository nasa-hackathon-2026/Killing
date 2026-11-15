// What a visitor sees with no query parameters: a couple of layers already
// on and the start card. A link that sets the view (?layers=, ?chart=, …)
// gets exactly what it asks for instead, with no card over it.

// The layers switched on when the address sets nothing.
export const DEFAULT_LAYERS = ["imerg_precip", "merra2_t2m"];

// Query parameters that set the starting view (urlParams.ts, and
// ?companions= of the companion panel).
export const VIEW_PARAMS = [
  "layers",
  "closeup",
  "trendmap",
  "month",
  "play",
  "chart",
  "strata",
  "at",
  "companions",
  "field",
];

export function hasViewParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return VIEW_PARAMS.some((name) => params.has(name));
}

// Layers on at the start: the ones the address lists; the defaults when the
// address sets nothing; otherwise (a link that sets something else, such as
// ?trendmap=) null, which keeps the layer registry's own default.
export function startingLayers(search: string): string[] | null {
  const asked = new URLSearchParams(search).get("layers");
  if (asked !== null) return asked.split(",").filter((id) => id.length > 0);
  return hasViewParams(search) ? null : DEFAULT_LAYERS;
}

export const GUIDE_STORAGE_KEY = "estd.guide.dismissed";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Storage can be missing or blocked (private mode, embedded pages); the
// card then simply shows again next time.
export function guideDismissed(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberGuideDismissed(
  store: Store | null = browserStore(),
): void {
  try {
    store?.setItem(GUIDE_STORAGE_KEY, "1");
  } catch {
    // Nothing to do: the card shows again on the next visit.
  }
}

// Whether the start card opens by itself.
export function showGuideAtStart(search: string, dismissed: boolean): boolean {
  return !hasViewParams(search) && !dismissed;
}
