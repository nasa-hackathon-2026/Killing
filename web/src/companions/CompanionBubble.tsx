import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";
import { placeBubble } from "./bubblePlacement";

// Seconds the bubble stays after a click; a bar along its bottom edge runs
// down over this time.
export const BUBBLE_SECONDS = 7;

type CompanionBubbleProps = {
  // The companion it speaks for: the bubble points at the element with
  // `data-companion-figure="<id>"`, or at the sidebar when there is none.
  companionId: string;
  // Where it is drawn: the page, outside the sidebar (which slides with a
  // transform and clips what is inside it).
  target: HTMLElement;
  // The pointer is on the bubble or focus is in it: the clock is stopped.
  held: boolean;
  onHold: (held: boolean) => void;
  label: string;
  children: ReactNode;
};

// A speech bubble that pops up beside a companion and disappears by itself
// (the dock's timer, useDismissTimer). It does not take any room in the
// sidebar, so opening it never moves the layers.
export function CompanionBubble({
  companionId,
  target,
  held,
  onHold,
  label,
  children,
}: CompanionBubbleProps) {
  const root = useRef<HTMLDivElement>(null);

  // Position by writing to the element, not through state: it follows the
  // companion when the page resizes or the sidebar scrolls, and a state
  // update on every scroll event would redraw the whole bubble each time.
  useLayoutEffect(() => {
    const bubble = root.current;
    if (!bubble) return;
    const place = () => {
      const anchor =
        document.querySelector(`[data-companion-figure="${companionId}"]`) ??
        document.getElementById("right-sidebar-panel");
      if (!anchor) return;
      const box = anchor.getBoundingClientRect();
      const spot = placeBubble(
        { left: box.left, top: box.top, width: box.width, height: box.height },
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      bubble.style.left = `${spot.left}px`;
      bubble.style.top = `${spot.top}px`;
      bubble.style.setProperty("--tail", `${spot.tail}px`);
      bubble.dataset.side = spot.side;
      bubble.style.visibility = "visible";
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bubble);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [companionId]);

  return createPortal(
    <div
      ref={root}
      role="status"
      aria-label={label}
      data-held={held ? "true" : "false"}
      onMouseEnter={() => onHold(true)}
      onMouseLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
      onBlur={() => onHold(false)}
      style={{ visibility: "hidden" }}
      className={cn(
        "group fixed z-[6] w-[min(272px,calc(100vw-24px))] animate-pop font-sans motion-reduce:animate-none",
        "data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom data-[side=bottom]:origin-top",
      )}
    >
      <div className="relative rounded-2xl border border-line bg-panel-solid text-[13px] leading-snug text-ink shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
        <div className="max-h-[min(60vh,340px)] overflow-y-auto p-3 pb-4">
          {children}
        </div>
        <span
          aria-hidden="true"
          style={
            {
              "--bubble-ms": `${BUBBLE_SECONDS * 1000}ms`,
            } as React.CSSProperties
          }
          className="pointer-events-none absolute inset-x-4 bottom-1.5 h-0.5 origin-left rounded-full bg-accent/50 animate-countdown group-data-[held=true]:[animation-play-state:paused] motion-reduce:hidden"
        />
      </div>
      <span
        aria-hidden="true"
        className={cn(
          "absolute size-3 rotate-45 border-line bg-panel-solid",
          "group-data-[side=left]:top-[calc(var(--tail)-6px)] group-data-[side=left]:-right-[6px] group-data-[side=left]:border-t group-data-[side=left]:border-r",
          "group-data-[side=right]:top-[calc(var(--tail)-6px)] group-data-[side=right]:-left-[6px] group-data-[side=right]:border-b group-data-[side=right]:border-l",
          "group-data-[side=top]:left-[calc(var(--tail)-6px)] group-data-[side=top]:-bottom-[6px] group-data-[side=top]:border-r group-data-[side=top]:border-b",
          "group-data-[side=bottom]:left-[calc(var(--tail)-6px)] group-data-[side=bottom]:-top-[6px] group-data-[side=bottom]:border-t group-data-[side=bottom]:border-l",
        )}
      />
    </div>,
    target,
  );
}
