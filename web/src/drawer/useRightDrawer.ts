import { useCallback, useState } from "react";
import {
  drawerOpenAtStart,
  rememberDrawerOpen,
  storedDrawerOpen,
} from "./drawerState";

// Open or closed, starting from the address, the stored choice or the
// screen width (drawerState.ts). `setOpen` is the visitor's choice (the
// handle, Escape) and is remembered; `close` is the page making room (a
// chart or close-up opened on a narrow screen) and is not.
export function useRightDrawer(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
} {
  const [open, setOpenState] = useState(() =>
    typeof window === "undefined"
      ? false
      : drawerOpenAtStart({
          width: window.innerWidth,
          stored: storedDrawerOpen(),
          search: window.location.search,
        }),
  );
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    rememberDrawerOpen(next);
  }, []);
  const close = useCallback(() => setOpenState(false), []);
  return { open, setOpen, close };
}
