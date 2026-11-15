// The right drawer: Layers and the statistics on the globe in one panel
// that slides in from the right edge. A handle on the edge opens and closes
// it; Escape closes it while the focus is in the drawer or on the handle
// (the tour and the Gather composition keep their own Escape). Whether it
// starts open, and remembering the choice, are in drawerState.ts.
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { nextOpenOnKey } from "./drawerState";
import "./drawer.css";

export const DRAWER_ID = "right-drawer";

type RightDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
};

export function RightDrawer({
  open,
  onOpenChange,
  children,
}: RightDrawerProps) {
  const { t } = useI18n();
  const handle = useRef<HTMLButtonElement>(null);
  const label = t("layers.drawerHandle");
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (nextOpenOnKey(open, event.key) === open) return;
    event.preventDefault();
    onOpenChange(false);
    // The focus was in the drawer, which is leaving the page's tab order.
    handle.current?.focus();
  };
  return (
    <div className="drawer-root" data-open={open} onKeyDown={onKeyDown}>
      <button
        ref={handle}
        type="button"
        className="drawer-handle"
        aria-expanded={open}
        aria-controls={DRAWER_ID}
        aria-label={t(open ? "layers.drawerClose" : "layers.drawerOpen")}
        title={label}
        onClick={() => onOpenChange(!open)}
      >
        <span aria-hidden="true">{open ? ">" : "<"}</span>
      </button>
      <div
        id={DRAWER_ID}
        className="right-drawer"
        role="region"
        aria-label={label}
        inert={!open}
      >
        {children}
      </div>
    </div>
  );
}
