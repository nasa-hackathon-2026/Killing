import { describe, expect, it } from "vitest";
import { hasMessage } from "../i18n";
import { COMPANIONS } from "../companions/companionSpec";
import { TABS } from "../investigation/logic";
import { bubblePlacement } from "./tourPlacement";
import {
  chapterStart,
  pageForStep,
  requestedTourStep,
  TOUR_CHAPTERS,
  TOUR_STEPS,
  tourMessageKey,
  tourScene,
  type VisitorState,
} from "./tourScript";

const visitor: VisitorState = {
  layers: ["omi_no2"],
  place: "taichung",
  chart: null,
  month: "2020-01-01",
};

describe("companion tour script", () => {
  it("has the intro, the four chapters in the panel's tab order, and the outro", () => {
    const chapters = TOUR_STEPS.map((step) => step.chapter).filter(
      (chapter, index, all) => all.indexOf(chapter) === index,
    );
    expect(chapters).toEqual(["intro", ...TABS, "outro"]);
    expect(TOUR_CHAPTERS).toEqual(TABS);
    for (const chapter of TABS) {
      const count = TOUR_STEPS.filter((s) => s.chapter === chapter).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("uses existing messages, in both voices where a step has them", () => {
    for (const step of TOUR_STEPS) {
      expect(step.messages.length + step.lines.length).toBeGreaterThan(0);
      for (const raw of step.messages) {
        for (const key of [
          tourMessageKey(raw, "calm"),
          tourMessageKey(raw, "lively"),
        ]) {
          const voiced = hasMessage(`${key}.general`);
          if (voiced) expect(hasMessage(`${key}.expert`)).toBe(true);
          else expect(hasMessage(key)).toBe(true);
        }
      }
      expect(COMPANIONS.some((item) => item.id === step.speaker)).toBe(true);
    }
    expect(hasMessage("guide.tour.nextResearcher")).toBe(true);
  });

  it("opens the panel on the tab of the chapter it explains", () => {
    for (const step of TOUR_STEPS) {
      if (step.scene.chart && TABS.includes(step.chapter as never)) {
        expect(step.scene.tab).toBe(step.chapter);
      }
    }
  });

  it("puts the page in the same state whatever the order of the steps", () => {
    const direct = TOUR_STEPS.map((_, index) => pageForStep(index, visitor));
    // Walk forward, backward and by random jumps: each step lands on the
    // same page as when it is opened directly.
    const order = [
      ...TOUR_STEPS.map((_, i) => i),
      ...TOUR_STEPS.map((_, i) => TOUR_STEPS.length - 1 - i),
      7,
      2,
      11,
      0,
      5,
      12,
      3,
      9,
    ];
    for (const index of order) {
      expect(pageForStep(index, visitor)).toEqual(direct[index]);
    }
    for (const page of direct) {
      expect(page.layers).toEqual(expect.arrayContaining(visitor.layers));
    }
    expect(pageForStep(0, visitor).place).toBe("taichung");
    expect(tourScene(999)).toEqual(tourScene(0));
  });

  it("reads ?tour= as a chapter", () => {
    expect(requestedTourStep("")).toBeNull();
    expect(requestedTourStep("?at=taipei")).toBeNull();
    expect(requestedTourStep("?tour=0")).toBe(0);
    expect(requestedTourStep("?tour=1")).toBe(chapterStart("what"));
    expect(requestedTourStep("?tour=3")).toBe(chapterStart("howmuch"));
    expect(requestedTourStep("?tour=significant")).toBe(
      chapterStart("significant"),
    );
    expect(requestedTourStep("?tour=9")).toBe(0);
    expect(TOUR_STEPS[chapterStart("where")]?.chapter).toBe("where");
  });

  it("words the particles step for the particle style", () => {
    expect(tourMessageKey("guide.tour.particles", "calm")).toBe(
      "guide.tour.particlesCalm",
    );
    expect(tourMessageKey("guide.tour.particles", "lively")).toBe(
      "guide.tour.particles",
    );
  });
});

describe("tour bubble placement", () => {
  const viewport = { width: 1440, height: 900 };
  const bubble = { width: 520, height: 180 };

  it("keeps the bubble off the region it talks about", () => {
    const target = { left: 12, top: 64, width: 440, height: 700 };
    const spot = bubblePlacement({
      bubble,
      viewport,
      targets: [target],
      panels: [],
      top: 64,
      margin: 12,
    });
    expect(spot.left).toBeGreaterThanOrEqual(target.left + target.width);
  });

  it("stays inside a phone screen", () => {
    const phone = { width: 390, height: 844 };
    const spot = bubblePlacement({
      bubble: { width: 366, height: 260 },
      viewport: phone,
      targets: [{ left: 0, top: 400, width: 390, height: 300 }],
      panels: [],
      top: 64,
      margin: 12,
    });
    expect(spot.left).toBeGreaterThanOrEqual(12);
    expect(spot.left + 366).toBeLessThanOrEqual(390 - 12 + 0.5);
    expect(spot.top + 260).toBeLessThanOrEqual(400);
  });
});
