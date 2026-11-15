// What the left side shows (#209). The chart of a layer and the close-up of a
// layer are two views of one slot, so they are never open together: the slot
// holds nothing, one layer's chart, or one layer's close-up. Choosing the one
// that is open again, or "Off", empties the slot. Everything here is pure; the
// state lives in TimelineContext, the controls in the Layers panel, and what
// the rest of the left side does about it is `leftContent` below.

export type LeftView =
  | { kind: "none" }
  | { kind: "chart"; id: string }
  | { kind: "closeup"; id: string };

export const NO_VIEW: LeftView = { kind: "none" };

// The two addresses ?chart= and ?closeup= may both be given. The close-up
// wins, as it did when both opened and it covered the chart.
export function initialLeftView(
  chart: string | null,
  closeup: string | null,
): LeftView {
  if (closeup) return { kind: "closeup", id: closeup };
  if (chart) return { kind: "chart", id: chart };
  return NO_VIEW;
}

export function chartIdOf(view: LeftView): string | null {
  return view.kind === "chart" ? view.id : null;
}

export function closeUpIdOf(view: LeftView): string | null {
  return view.kind === "closeup" ? view.id : null;
}

// Opens the chart of `id` (replacing a close-up). With null it closes the
// chart, and leaves a close-up as it is.
export function withChart(view: LeftView, id: string | null): LeftView {
  if (id) return { kind: "chart", id };
  return view.kind === "chart" ? NO_VIEW : view;
}

export function withCloseUp(view: LeftView, id: string | null): LeftView {
  if (id) return { kind: "closeup", id };
  return view.kind === "closeup" ? NO_VIEW : view;
}

// The radio group of one layer in the Layers panel. The group is "off" unless
// this layer is the one in the slot, so choosing in another layer's group
// empties this one without any code for it.
export type ViewChoice = "off" | "closeup" | "chart";

export const VIEW_CHOICES: ViewChoice[] = ["off", "closeup", "chart"];

export function choiceOf(view: LeftView, layerId: string): ViewChoice {
  return view.kind !== "none" && view.id === layerId ? view.kind : "off";
}

// "Off" empties the slot only when it is this layer's own; another layer's
// "Off" is already the state of this layer and changes nothing.
export function chooseView(
  view: LeftView,
  layerId: string,
  choice: ViewChoice,
): LeftView {
  if (choice === "off") {
    return view.kind !== "none" && view.id === layerId ? NO_VIEW : view;
  }
  return { kind: choice, id: layerId };
}

export type LeftContent = {
  // The one big panel on the left.
  primary: "closeup" | "chart" | "guide" | "none";
  // The map legends under it (the trend map, the statistics on the globe, the
  // line about the particles): all of them, a short scrolling window above
  // the chart, or none.
  legends: "full" | "compact" | "hidden";
};

// The rules for the left side, in one place. The tour and the start card sit
// where the chart and the close-up sit, so they give way to a view and a view
// gives way to the tour; the close-up needs the room of the legends, the chart
// leaves a short window of them; the layer view has its own legend column.
export function leftContent(input: {
  view: LeftView;
  guideOpen: boolean;
  tourActive: boolean;
  strataOn: boolean;
}): LeftContent {
  const { view, guideOpen, tourActive, strataOn } = input;
  if (strataOn) {
    return {
      primary: view.kind === "chart" ? "chart" : "none",
      legends: "hidden",
    };
  }
  if (tourActive) return { primary: "none", legends: "hidden" };
  if (view.kind === "closeup") return { primary: "closeup", legends: "hidden" };
  if (view.kind === "chart") return { primary: "chart", legends: "compact" };
  if (guideOpen) return { primary: "guide", legends: "hidden" };
  return { primary: "none", legends: "full" };
}
