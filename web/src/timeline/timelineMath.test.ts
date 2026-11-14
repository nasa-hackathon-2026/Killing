import { describe, expect, it } from "vitest";
import {
  clampIndex,
  monthFromNumber,
  monthLabel,
  monthNumber,
  nextPlayIndex,
  parseMonthParam,
  resolveMonth,
} from "./timelineMath";

describe("month numbers", () => {
  it("round-trips and counts months across a year boundary", () => {
    expect(monthFromNumber(monthNumber("2001-01-01"))).toBe("2001-01-01");
    expect(monthFromNumber(monthNumber("2026-12-01"))).toBe("2026-12-01");
    expect(monthNumber("2002-01-01") - monthNumber("2001-12-01")).toBe(1);
    expect(monthFromNumber(monthNumber("2001-11-01") + 3)).toBe("2002-02-01");
  });

  it("labels a month", () => {
    expect(monthLabel("2015-07-01")).toEqual({ year: "2015", name: "Jul" });
  });
});

describe("clampIndex", () => {
  it("keeps the index inside the range", () => {
    expect(clampIndex(-3, 10)).toBe(0);
    expect(clampIndex(4, 10)).toBe(4);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(Number.NaN, 10)).toBe(0);
  });

  it("is -1 when there are no months", () => {
    expect(clampIndex(0, 0)).toBe(-1);
  });
});

describe("nextPlayIndex", () => {
  it("advances one month and stops at the last", () => {
    expect(nextPlayIndex(0, 3)).toBe(1);
    expect(nextPlayIndex(1, 3)).toBe(2);
    expect(nextPlayIndex(2, 3)).toBeNull();
    expect(nextPlayIndex(-1, 3)).toBeNull();
    expect(nextPlayIndex(0, 0)).toBeNull();
  });
});

describe("parseMonthParam", () => {
  it("accepts YYYY-MM and YYYY-MM-DD", () => {
    expect(parseMonthParam("2015-07")).toBe("2015-07-01");
    expect(parseMonthParam("2015-07-15")).toBe("2015-07-01");
  });

  it("rejects anything else", () => {
    expect(parseMonthParam(null)).toBeNull();
    expect(parseMonthParam("2015")).toBeNull();
    expect(parseMonthParam("2015-13")).toBeNull();
    expect(parseMonthParam("july")).toBeNull();
  });
});

describe("resolveMonth", () => {
  const months = ["2001-01-01", "2001-02-01", "2001-03-01"];

  it("prefers the chosen month, then the fallback, then the last", () => {
    expect(resolveMonth(months, "2001-02-01", "2001-01-01")).toBe("2001-02-01");
    expect(resolveMonth(months, "1999-01-01", "2001-01-01")).toBe("2001-01-01");
    expect(resolveMonth(months, null, null)).toBe("2001-03-01");
    expect(resolveMonth([], "2001-02-01", null)).toBeNull();
  });
});
