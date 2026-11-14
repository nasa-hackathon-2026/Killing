import { describe, expect, it } from "vitest";
import { mockVariables } from "../mock/snapshot";
import { formColor, lightness, PALE_LIGHTNESS } from "./formColor";

describe("formColor", () => {
  it("measures lightness", () => {
    expect(lightness("#ffffff")).toBe(1);
    expect(lightness("#000000")).toBe(0);
    expect(lightness("#ff0000")).toBeCloseTo(0.5);
    expect(lightness("white")).toBe(0);
  });

  it("uses the glass color when the particle color is close to white", () => {
    expect(formColor({ glassColor: "#2f9e57", particleColor: "#d9f5e4" })).toBe(
      "#2f9e57",
    );
    expect(formColor({ glassColor: "#a86832", particleColor: "#e0b080" })).toBe(
      "#e0b080",
    );
  });

  it("only ever returns one of the variable's two existing colors", () => {
    for (const variable of mockVariables) {
      const color = formColor(variable);
      expect([variable.glassColor, variable.particleColor]).toContain(color);
      if (color === variable.particleColor) {
        expect(lightness(color)).toBeLessThanOrEqual(PALE_LIGHTNESS);
      }
    }
  });

  it("gives every layer a different particle color", () => {
    const colors = mockVariables.map((variable) => formColor(variable));
    expect(new Set(colors).size).toBe(colors.length);
  });
});
