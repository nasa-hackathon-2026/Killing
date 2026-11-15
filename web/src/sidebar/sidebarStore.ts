// The open/closed state of the right sidebar, shared by the sidebar itself
// and by the parts that need to open it (the guided tour, the companion
// narration) or close it (a chart or close-up opening on a narrow screen).

import { useSyncExternalStore } from "react";
import { hasViewParams } from "../guide/firstVisit";
import { rememberFlag, storedFlag } from "../i18n";
import { initialSidebarOpen, SIDEBAR_STORAGE_KEY } from "./sidebarState";

let open: boolean | null = null;
const listeners = new Set<() => void>();

function current(): boolean {
  if (open === null) {
    open =
      typeof window === "undefined"
        ? true
        : initialSidebarOpen({
            stored: storedFlag(SIDEBAR_STORAGE_KEY),
            hasViewParams: hasViewParams(window.location.search),
            width: window.innerWidth,
          });
  }
  return open;
}

// `remember` is false for a change the reader did not make (the tour opening
// the sidebar), so it does not become their stored choice.
export function setSidebarOpen(next: boolean, remember = true): void {
  if (current() === next) return;
  open = next;
  if (remember) rememberFlag(SIDEBAR_STORAGE_KEY, next);
  for (const listener of listeners) listener();
}

export function isNarrowScreen(): boolean {
  return typeof window !== "undefined" && window.innerWidth <= 700;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSidebarOpen(): boolean {
  return useSyncExternalStore(subscribe, current, () => true);
}
