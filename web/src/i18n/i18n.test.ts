import { afterEach, describe, expect, it } from "vitest";
import {
  detectLocale,
  detectRole,
  getRole,
  setLocale,
  setRole,
  t,
  tm,
} from "./index";

afterEach(() => {
  setLocale("en");
  setRole("everyone");
});

describe("reader choices", () => {
  it("gives a link priority over saved and browser choices", () => {
    expect(detectLocale("?lang=ja", "zh-TW", ["de-DE"])).toBe("ja");
    expect(detectRole("?mode=research", "student")).toBe("researcher");
    expect(detectRole("?role=student&mode=research", "everyone")).toBe(
      "student",
    );
  });

  it("keeps the same trend fact while changing the reader wording", () => {
    setRole("everyone");
    expect(getRole()).toBe("everyone");
    expect(tm("trend.change", { slope: "+0.21 °C" })).toContain("+0.21 °C");
    setRole("researcher");
    expect(
      tm("trend.change", {
        slope: "+0.21 °C",
        level: 95,
        low: "0.12",
        high: "0.30",
      }),
    ).toContain("0.12");
  });

  it("falls back to English when a translated key is unavailable", () => {
    setLocale("de");
    expect(t("common.role.researcher.name")).toBe("Researcher");
  });
});
