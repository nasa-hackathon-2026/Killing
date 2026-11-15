// THE TOUR SCRIPT. The guided tour is data: a list of steps in chapters that
// follow the four questions of the challenge, numbered like the four tabs of
// the investigation panel (① What, ② Where, ③ How much, ④ Significant).
// Each step names who speaks, what is said (message keys, or template
// sentences of the speaking companion), the region of the page it talks
// about, and the whole state the page is put in (`TourScene`). The page
// applies a step's scene with the actions it already has; nothing here draws
// anything.
//
// A scene is complete, so applying it does not depend on the step before:
// jumping from any step to any step gives the same page. Wording is in the
// message files: `guide.tour.*` for the fixed lines, `companions.say.*` for
// the template sentences filled with the place's numbers.
import { TABS, type TabId } from "../investigation/logic";

export type TourChapter = "intro" | TabId | "outro";

// The numbered chapters, in the order of the investigation panel's tabs.
export const TOUR_CHAPTERS: readonly TabId[] = TABS;

// The template sentences a companion can say (companionLine.ts).
export type TourLine = "who" | "now" | "trend";

// What the page shows during a step. Anything not listed is put back to
// what the visitor had when the tour started.
export type TourScene = {
  // Layers switched on (on top of the ones the visitor had on).
  layers: string[];
  // Variable of the investigation panel, or null for the panel closed.
  chart: string | null;
  // The panel's tab (ignored while it is closed).
  tab: TabId;
  // Place id, or null for the place the visitor was at.
  place: string | null;
  // The timeline plays during the step.
  play: boolean;
};

// The region a step talks about: a CSS selector, the row of one layer in
// the Layers panel, or a control of the top bar. A region that is not on
// the page is simply not marked.
export type TourTarget =
  | { css: string }
  | { layer: string }
  // A labelled control of the top bar, by the message key of its label.
  | { hudLabel: string };

export type TourStep = {
  id: string;
  chapter: TourChapter;
  // Variable id of the companion that speaks.
  speaker: string;
  // Fixed lines: message keys. A key with `.general` / `.expert` children
  // is read in the voice of the active role.
  messages: string[];
  // Template sentences of the speaker, said after the fixed lines.
  lines: TourLine[];
  scene: TourScene;
  targets: TourTarget[];
};

const RAIN = "imerg_precip";
const WARMTH = "merra2_t2m";
const GLDAS_AIR = "gldas_tair";
const PANEL: TourTarget = { css: ".timeline-chart" };
const TIMELINE: TourTarget = { css: ".timeline-bar" };
const TREND_MAP: TourTarget = { hudLabel: "hud.trendMap" };

const AT_HOME: TourScene = {
  layers: [RAIN, WARMTH],
  chart: null,
  tab: "what",
  place: null,
  play: false,
};

function step(
  id: string,
  chapter: TourChapter,
  speaker: string,
  scene: Partial<TourScene>,
  targets: TourTarget[],
  lines: TourLine[] = [],
): TourStep {
  return {
    id,
    chapter,
    speaker,
    messages: lines.length > 0 ? [] : [`guide.tour.${id}`],
    lines,
    scene: { ...AT_HOME, ...scene },
    targets,
  };
}

export const TOUR_STEPS: TourStep[] = [
  step("welcome", "intro", RAIN, {}, []),
  step("particles", "intro", RAIN, {}, []),
  // ① What is changing? The companion says what it is and this month's
  // value, then the panel shows the whole record.
  step("what.who", "what", RAIN, {}, [{ layer: RAIN }], ["who"]),
  step("what.now", "what", RAIN, {}, [{ layer: RAIN }, TIMELINE], ["now"]),
  step("what.tab", "what", RAIN, { chart: RAIN, tab: "what" }, [PANEL]),
  // ② Where is it changing?
  step("where.tab", "where", RAIN, { chart: RAIN, tab: "where" }, [PANEL]),
  step(
    "where.city",
    "where",
    RAIN,
    { chart: RAIN, tab: "where", place: "tokyo" },
    [PANEL, TREND_MAP],
  ),
  // ③ How much? The record of a measurement with a clear trend.
  step(
    "howmuch.anomaly",
    "howmuch",
    WARMTH,
    { chart: WARMTH, tab: "howmuch" },
    [PANEL],
  ),
  step(
    "howmuch.play",
    "howmuch",
    WARMTH,
    { chart: WARMTH, tab: "howmuch", play: true },
    [PANEL, TIMELINE],
  ),
  // ④ Is it significant?
  step(
    "significant.tests",
    "significant",
    WARMTH,
    { chart: WARMTH, tab: "significant" },
    [PANEL],
  ),
  step(
    "significant.notSignificant",
    "significant",
    RAIN,
    { chart: RAIN, tab: "significant" },
    [PANEL],
  ),
  // A record with a documented data problem; at Taipei its test finds a
  // change, so the striped "not reliable" mark shows.
  step(
    "significant.caveat",
    "significant",
    GLDAS_AIR,
    {
      layers: [RAIN, WARMTH, GLDAS_AIR],
      chart: GLDAS_AIR,
      tab: "significant",
      place: "taipei",
    },
    [PANEL],
  ),
  step("outro", "outro", RAIN, {}, []),
];

// The first step of a chapter (a numbered chapter, or the intro).
export function chapterStart(chapter: TourChapter): number {
  return Math.max(
    0,
    TOUR_STEPS.findIndex((item) => item.chapter === chapter),
  );
}

// The scene of a step; a step outside the script gets the opening scene.
export function tourScene(index: number): TourScene {
  return TOUR_STEPS[index]?.scene ?? AT_HOME;
}

// What the visitor had before the tour, put back when it ends.
export type VisitorState = {
  layers: string[];
  place: string;
  chart: string | null;
  month: string | null;
};

// The page's state during a step, from the visitor's own state: a pure
// function of the step, so the order of the steps does not matter.
export function pageForStep(
  index: number,
  visitor: VisitorState,
): { layers: string[]; place: string; chart: string | null; play: boolean } {
  const scene = tourScene(index);
  return {
    layers: [...new Set([...visitor.layers, ...scene.layers])],
    place: scene.place ?? visitor.place,
    chart: scene.chart,
    play: scene.play,
  };
}

// ?tour=1…4 (or what|where|howmuch|significant) opens the tour at that
// chapter, ?tour=0 (or any other value) at the start. Null without it.
export function requestedTourStep(search: string): number | null {
  const value = new URLSearchParams(search).get("tour");
  if (value === null) return null;
  const number = Number(value);
  const chapter =
    Number.isInteger(number) && number >= 1 && number <= TOUR_CHAPTERS.length
      ? TOUR_CHAPTERS[number - 1]
      : TOUR_CHAPTERS.find((item) => item === value);
  return chapter ? chapterStart(chapter) : 0;
}

// The particles step reads differently in the Calm style: there the
// particles are one small cluster above the place, not spread around the
// globe.
export function tourMessageKey(key: string, style: "calm" | "lively"): string {
  return style === "calm" && key === "guide.tour.particles"
    ? "guide.tour.particlesCalm"
    : key;
}

// The next things to try on the last step: existing examples of the start
// card (examples.ts) and the Researcher role.
export const TOUR_NEXT = [
  "no2-los-angeles",
  "global-trend-map",
  "researcher",
] as const;
