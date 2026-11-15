import { afterEach, expect, it } from "vitest";
import { registerMessages, setLocale } from "../i18n";
import zh from "../i18n/locales/zh-TW/globeStats.json";
import { GLOBE_STATS_TEXT } from "./globeStatsText";

afterEach(() => setLocale("en"));

it("updates controls and scientific cautions without reloading the page", () => {
  expect(GLOBE_STATS_TEXT.controlLabel).toBe("On the globe");
  registerMessages("zh-TW", { globeStats: zh });
  setLocale("zh-TW");
  expect(GLOBE_STATS_TEXT.controlLabel).toBe("地球上的統計");
  expect(GLOBE_STATS_TEXT.alikeNotCause).toContain("不代表因果");
  expect(GLOBE_STATS_TEXT.trendSolid).toContain("FDR");
});
