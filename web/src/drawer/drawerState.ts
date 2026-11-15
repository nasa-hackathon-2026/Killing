// Whether the right drawer (Layers and the statistics on the globe) is open.
// Pure functions; the drawer component reads the window and storage once.
import { hasViewParams } from "../guide/firstVisit";

// Wider than this the drawer starts open (the same break as the panels'
// docking rules).
export const DRAWER_WIDE_WIDTH = 1180;
export const DRAWER_STORAGE_KEY = "estd.drawer.open";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// A link that sets the view opens the drawer, so its layers can be seen;
// otherwise the visitor's last choice; otherwise open only on a wide screen.
export function drawerOpenAtStart({
  width,
  stored,
  search,
}: {
  width: number;
  stored: boolean | null;
  search: string;
}): boolean {
  if (hasViewParams(search)) return true;
  if (stored !== null) return stored;
  return width > DRAWER_WIDE_WIDTH;
}

// The stored choice; null when there is none or storage is blocked.
export function storedDrawerOpen(
  store: Store | null = browserStore(),
): boolean | null {
  try {
    const value = store?.getItem(DRAWER_STORAGE_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

export function rememberDrawerOpen(
  open: boolean,
  store: Store | null = browserStore(),
): void {
  try {
    store?.setItem(DRAWER_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // Storage is blocked: the drawer starts from the screen width next time.
  }
}

// Escape closes an open drawer; other keys change nothing.
export function nextOpenOnKey(open: boolean, key: string): boolean {
  return key === "Escape" ? false : open;
}
