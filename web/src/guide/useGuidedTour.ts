// The guided tour's state and how a step is put on the page. Every step is
// applied whole from its scene (tourScript.ts `pageForStep`), so jumping
// from any step to any other gives the same page, and a visitor's own
// clicks during the tour are simply overwritten by the next step. When the
// tour ends (Skip, Esc, the last Next) the page goes back to the layers,
// place, chart and month the visitor had when it started.
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { useTimeline } from "../timeline/TimelineContext";
import { pageForStep, tourScene, type VisitorState } from "./tourScript";

type GuidedTourInput = {
  // The step to open at (first visit or ?tour=), or null.
  initialStep: number | null;
  // Ids of the layers switched on, and how to set them.
  visibleLayers: string[];
  setVisibleLayers: (ids: string[]) => void;
  // The selected place, and the place menu's own action.
  place: string;
  selectPlace: (id: string) => void;
  // The place list is loaded (a step may pick a place).
  ready: boolean;
  // The layer view is open, and how to leave it (the tour is on the globe).
  strataOn: boolean;
  exitStrata: () => void;
};

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function useGuidedTour(input: GuidedTourInput) {
  const timeline = useTimeline();
  const [step, setStep] = useState<number | null>(input.initialStep);
  // Bumped on every application, so the panel's tab is set again even when
  // two steps share a tab.
  const [applied, setApplied] = useState(0);
  const visitor = useRef<VisitorState | null>(null);
  const pending = useRef(input.initialStep !== null);

  const apply = (index: number) => {
    if (visitor.current === null) {
      visitor.current = {
        layers: input.visibleLayers,
        place: input.place,
        chart: timeline.selectedVariableId,
        month: timeline.month,
      };
    }
    const page = pageForStep(index, visitor.current);
    if (!sameSet(page.layers, input.visibleLayers)) {
      input.setVisibleLayers(page.layers);
    }
    if (page.place !== input.place) input.selectPlace(page.place);
    if (input.strataOn) input.exitStrata();
    timeline.setSelectedVariableId(page.chart);
    const play = page.play && !prefersReducedMotion();
    if (play !== timeline.playing) timeline.setPlaying(play);
    // Only the playing step moves the month; the others show the visitor's.
    const month = visitor.current.month;
    if (!play && month && month !== timeline.month) timeline.setMonth(month);
    setApplied((count) => count + 1);
  };

  // A tour that opens with the page waits for the place list.
  useEffect(() => {
    if (pending.current && input.ready && step !== null) {
      pending.current = false;
      apply(step);
    }
  });

  const go = (index: number) => {
    setStep(index);
    apply(index);
  };

  const end = () => {
    const before = visitor.current;
    visitor.current = null;
    pending.current = false;
    setStep(null);
    timeline.setPlaying(false);
    if (!before) return;
    input.setVisibleLayers(before.layers);
    if (before.place !== input.place) input.selectPlace(before.place);
    timeline.setSelectedVariableId(before.chart);
    if (before.month) timeline.setMonth(before.month);
  };

  const scene = step === null ? null : tourScene(step);
  return {
    step,
    go,
    end,
    // The investigation panel's tab for the current step.
    tab: scene?.chart ? { tab: scene.tab, key: applied } : null,
  };
}
