import { describe, expect, it } from "vitest";
import { nextPhase, type StrataPhase } from "./useStrataMode";

describe("nextPhase", () => {
  it("walks in and out of the layer view in order", () => {
    let phase: StrataPhase = "off";
    const seen: StrataPhase[] = [];
    for (const event of [
      "enter",
      "arrive",
      "exit",
      "closed",
      "return",
    ] as const) {
      phase = nextPhase(phase, event);
      seen.push(phase);
    }
    expect(seen).toEqual(["approach", "on", "closing", "return", "off"]);
  });

  it("ignores events that do not belong to the current step", () => {
    expect(nextPhase("off", "arrive")).toBe("off");
    expect(nextPhase("off", "exit")).toBe("off");
    expect(nextPhase("on", "enter")).toBe("on");
    expect(nextPhase("on", "return")).toBe("on");
    expect(nextPhase("closing", "exit")).toBe("closing");
  });

  it("flies straight back when left during the approach", () => {
    expect(nextPhase("approach", "exit")).toBe("return");
  });
});
