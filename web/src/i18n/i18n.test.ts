import { afterEach, describe, expect, it } from "vitest";
import {
  detectLocale,
  detectRole,
  getRole,
  getMessageLocale,
  monthName,
  monthYear,
  monthYearParts,
  registerMessages,
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

  it("uses the active language only when the companion text is translated", () => {
    registerMessages("ja", {
      companions: { say: { noMonth: "No month is selected yet." } },
    });
    registerMessages("zh-TW", {
      companions: { say: { noMonth: "還沒有選月份。" } },
    });

    setLocale("ja");
    expect(getMessageLocale("companions.say.noMonth")).toBe("en");
    setLocale("zh-TW");
    expect(getMessageLocale("companions.say.noMonth")).toBe("zh-TW");
  });

  it("formats a spoken month in its text language without changing the UI locale", () => {
    setLocale("ja");
    expect(monthYear("2015-07-01", "long", "en")).toBe("July 2015");
    expect(monthName("2015-07-01", "long", "en")).toBe("July");
    expect(monthYear("2015-07-01")).toBe("2015年7月");
  });
});

describe("site-wide month text", () => {
  it("spaces every Traditional Chinese month the same way", () => {
    setLocale("zh-TW");
    expect(monthYear("2025-06-01")).toBe("2025 年 6 月");
    expect(monthYear("2025-06-01", "short")).toBe("2025 年 6 月");
    expect(monthName("2025-06-01")).toBe("6 月");
    expect(monthName("2025-11-01", "short")).toBe("11 月");
  });

  it("leaves the other languages as Intl writes them", () => {
    expect(monthYear("2025-06-01", "long", "ja")).toBe("2025年6月");
    expect(monthName("2025-06-01", "long", "ja")).toBe("6月");
    expect(monthYear("2025-06-01", "long", "de")).toBe("Juni 2025");
    expect(monthYear("2025-13-01", "long", "zh-TW")).toBe("2025-13");
  });
});

describe("monthYearParts", () => {
  const joined = (parts: { text: string }[]) =>
    parts.map((part) => part.text).join("");
  const year = (parts: { text: string; year: boolean }[]) =>
    parts.filter((part) => part.year).map((part) => part.text);

  it("spaces digits and Han characters in Traditional Chinese", () => {
    const parts = monthYearParts("2025-06-01", "short", "zh-TW");
    expect(joined(parts)).toBe("2025 年 6 月");
    expect(year(parts)).toEqual(["2025"]);
  });

  it("keeps Japanese without spaces", () => {
    expect(joined(monthYearParts("2025-06-01", "short", "ja"))).toBe(
      "2025年6月",
    );
  });

  it("follows each language's order and marks only the year", () => {
    const parts = monthYearParts("2025-06-01", "short", "en");
    expect(joined(parts)).toBe("Jun 2025");
    expect(year(parts)).toEqual(["2025"]);
    expect(joined(monthYearParts("2025-12-01", "short", "zh-TW"))).toBe(
      "2025 年 12 月",
    );
  });

  it("falls back to the raw month when it is not a month", () => {
    expect(monthYearParts("2025-13-01", "short", "zh-TW")).toEqual([
      { text: "2025-13", year: false },
    ]);
  });
});
