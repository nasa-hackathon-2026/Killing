import { describe, expect, it } from "vitest";
import { clickSelection, nextNarration } from "./narration";

const open = { visibleIds: ["a", "b"], locationId: "p", playing: false };

describe("clicking a companion", () => {
  it("opens its bubble when nothing is open", () => {
    expect(clickSelection({ id: null, caveat: false }, "a", false)).toEqual({
      id: "a",
      caveat: false,
    });
  });

  it("closes it when the open one is clicked again", () => {
    expect(
      clickSelection({ id: "a", caveat: false }, "a", false).id,
    ).toBeNull();
  });

  it("switches to another companion in one click", () => {
    expect(clickSelection({ id: "a", caveat: false }, "b", false).id).toBe("b");
  });

  it("opens the caution view of the one whose plain view is open", () => {
    expect(clickSelection({ id: "a", caveat: false }, "a", true)).toEqual({
      id: "a",
      caveat: true,
    });
  });

  it("does not depend on the narration switch: with it off, a click still opens", () => {
    // Turning the switch off only stops nextNarration from speaking up ...
    expect(
      nextNarration(open, { ...open, visibleIds: ["a", "b", "c"] }, null, [
        "c",
        "b",
        "a",
      ]),
    ).toBe("c");
    // ... and clickSelection has no such input, so a click opens regardless.
    expect(clickSelection({ id: null, caveat: false }, "b", false).id).toBe(
      "b",
    );
  });
});
