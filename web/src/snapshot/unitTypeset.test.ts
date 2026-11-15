import { describe, expect, it } from "vitest";
import { typesetUnits } from "./unitTypeset";

describe("typesetUnits", () => {
  it("raises caret, hyphen and slash exponents", () => {
    expect(typesetUnits("molecules/cm^2")).toEqual([
      { kind: "text", text: "molecules/cm" },
      { kind: "sup", text: "2" },
    ]);
    expect(typesetUnits("kg m-2 s-1")).toEqual([
      { kind: "text", text: "kg m" },
      { kind: "sup", text: "−2" },
      { kind: "text", text: " s" },
      { kind: "sup", text: "−1" },
    ]);
    expect(typesetUnits("kg/m2")).toEqual([
      { kind: "text", text: "kg/m" },
      { kind: "sup", text: "2" },
    ]);
    expect(typesetUnits("s^-1")).toEqual([
      { kind: "text", text: "s" },
      { kind: "sup", text: "−1" },
    ]);
  });

  it("leaves scientific notation, dates and ordinary units alone", () => {
    for (const text of [
      "9.57e-7",
      "+9.57e-7",
      "2.86e-7 to 1.63e-6",
      "2001-01 to 2026-06",
      "27.4 °C",
      "0.23 mm/hr",
      "No data",
      "",
    ]) {
      expect(typesetUnits(text)).toEqual([{ kind: "text", text }]);
    }
  });

  it("typesets only the unit inside a trend sentence", () => {
    expect(
      typesetUnits(
        "+9.57e-7 kg m-2 s-1 per decade (95% CI 2.86e-7 to 1.63e-6)",
      ),
    ).toEqual([
      { kind: "text", text: "+9.57e-7 kg m" },
      { kind: "sup", text: "−2" },
      { kind: "text", text: " s" },
      { kind: "sup", text: "−1" },
      { kind: "text", text: " per decade (95% CI 2.86e-7 to 1.63e-6)" },
    ]);
  });
});
