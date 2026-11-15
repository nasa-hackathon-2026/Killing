import type { KeyboardEvent, ReactNode } from "react";
import { useI18n } from "../i18n";
import { cn } from "../lib/cn";
import { setSidebarOpen, useSidebarOpen } from "./sidebarStore";

const PANEL_ID = "right-sidebar-panel";

// The right sidebar (#207): the Layers panel and the companions in one
// panel that slides in from the right edge and back out, with a handle on its
// left edge that stays on screen. Closed, the panel is moved out of the page
// and made inert, so nothing in it can be reached by keyboard. The globe and
// the other panels keep their places either way.
export function RightSidebar({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const open = useSidebarOpen();
  const label = t(open ? "layers.sidebarClose" : "layers.sidebarOpen");

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !open) return;
    // Esc inside the panel closes it, but not an open menu or dialog in it.
    if (event.defaultPrevented) return;
    event.stopPropagation();
    setSidebarOpen(false);
    document
      .querySelector<HTMLElement>(`[aria-controls="${PANEL_ID}"]`)
      ?.focus();
  }

  return (
    <div
      className={cn(
        "right-sidebar pointer-events-none absolute inset-y-0 right-0 z-[1] w-[min(318px,100%)]",
        "transition-transform duration-[250ms] ease-out motion-reduce:transition-none",
        open ? "translate-x-0 max-[700px]:z-[4]" : "translate-x-full",
      )}
      data-open={open}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={label}
        title={label}
        onClick={() => setSidebarOpen(!open)}
        className={cn(
          "pointer-events-auto absolute top-1/2 -left-7 flex h-16 w-7 -translate-y-1/2 cursor-pointer items-center justify-center p-0",
          "rounded-l-lg border border-r-0 border-line bg-panel-solid text-ink hover:bg-white/10",
        )}
      >
        <svg
          viewBox="0 0 12 12"
          width="12"
          height="12"
          aria-hidden="true"
          className={cn(
            "transition-transform motion-reduce:transition-none",
            open ? "rotate-180" : "rotate-0",
          )}
        >
          <polyline
            points="7.5,2.5 4,6 7.5,9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        id={PANEL_ID}
        inert={!open}
        className={cn(
          "pointer-events-auto absolute top-16 right-3 box-border flex w-[calc(100%-12px)] max-h-[calc(100%-76px)] flex-col overflow-hidden",
          "rounded-lg border border-line bg-[rgba(8,14,28,0.9)] p-3 text-[13px] leading-[1.35] text-ink backdrop-blur-md",
          "max-[700px]:max-h-[calc(100%-60px-var(--timeline-bottom,92px)-var(--timeline-height,112px)-8px)] max-[700px]:top-[60px]",
        )}
      >
        {/* The companions come first and keep to the top (at most 45% of the
            panel, scrolling inside); the layers under them take the rest and
            scroll. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-3",
            "[&>:first-child]:shrink-0 [&>:first-child]:overflow-y-auto [&>:first-child]:border-b [&>:first-child]:border-line/40 [&>:first-child]:pb-3",
            "[&>:last-child]:min-h-[9rem] [&>:last-child]:flex-1 [&>:last-child]:overflow-y-auto [&>:last-child]:[scrollbar-gutter:stable]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
