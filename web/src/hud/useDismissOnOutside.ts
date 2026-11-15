import { useEffect, type RefObject } from "react";
import { menuDismiss, type MenuPointer } from "./menuDismiss";

function listenForDismiss(
  ref: RefObject<HTMLElement | null>,
  isOpen: () => boolean,
  onDismiss: () => void,
) {
  const root = ref.current;
  if (!root) return;
  const closeIf = (where: MenuPointer) => {
    if (menuDismiss(where, isOpen()) === "close") onDismiss();
  };
  const onPointer = (event: PointerEvent) => {
    const target = event.target;
    const inside = target instanceof Node && root.contains(target);
    closeIf(inside ? "inside" : "outside");
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeIf("escape");
  };
  document.addEventListener("pointerdown", onPointer);
  document.addEventListener("keydown", onKey);
  return () => {
    document.removeEventListener("pointerdown", onPointer);
    document.removeEventListener("keydown", onKey);
  };
}

// Closes an open custom menu when the pointer lands outside it or Escape is
// pressed. A pointer on an item does not close it.
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    return listenForDismiss(ref, () => true, onDismiss);
  }, [open, ref, onDismiss]);
}

// Closes a <details> menu the same way. The open flag lives on the element,
// so a re-render does not have to track it. Native <select> menus are not
// involved.
export function useDismissOpenDetails(
  ref: RefObject<HTMLDetailsElement | null>,
) {
  useEffect(
    () =>
      listenForDismiss(
        ref,
        () => ref.current?.open ?? false,
        () => {
          const root = ref.current;
          if (root) root.open = false;
        },
      ),
    [ref],
  );
}
