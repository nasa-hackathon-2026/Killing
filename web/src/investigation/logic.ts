// The decisions behind the investigation panel, as pure functions: which
// tab a link opens, which question group a variable is in, and whether the
// linear test and the Mann-Kendall test agree. Statistics are read from
// trends.json only.
import type { TestResult, TrendEntry } from "../analysis/trends";
import groupsFile from "./groups.json";

export const TABS = ["what", "where", "howmuch", "significant"] as const;
export type TabId = (typeof TABS)[number];

export function parseTab(value: string | null | undefined): TabId {
  return TABS.includes(value as TabId) ? (value as TabId) : "what";
}

// Arrow keys move between the four tabs and wrap; Home and End jump to the
// ends. Null for any other key.
export function nextTab(current: TabId, key: string): TabId | null {
  const at = TABS.indexOf(current);
  if (key === "ArrowRight" || key === "ArrowDown") {
    return TABS[(at + 1) % TABS.length] ?? null;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return TABS[(at + TABS.length - 1) % TABS.length] ?? null;
  }
  if (key === "Home") return TABS[0];
  if (key === "End") return TABS[TABS.length - 1] ?? null;
  return null;
}

export type QuestionGroup = { id: string; variables: string[] };

export const QUESTION_GROUPS: QuestionGroup[] = groupsFile.groups;

export function groupOf(variableId: string): QuestionGroup | undefined {
  return QUESTION_GROUPS.find((group) => group.variables.includes(variableId));
}

// A test result as trends.json writes it, with the statistic's sign where
// the test has one (Mann-Kendall's z).
export type SignedTest = TestResult & { z?: number | null };

export type Verdict = "significant" | "rawOnly" | "notSignificant" | "none";

// The three-way light next to each test: significant after FDR, only
// before FDR, or not significant (none: the test has no p value).
export function verdictOf(test: TestResult | undefined): Verdict {
  if (!test || test.p === null || test.significant === null) return "none";
  if (!test.significant) return "notSignificant";
  return test.significant_fdr ? "significant" : "rawOnly";
}

export type Agreement = "bothSame" | "bothNone" | "disagree" | "unknown";

// The Mann-Kendall result the agreement check uses: Hamed-Rao (the variant
// with an autocorrelation correction, like the linear test), or the
// seasonal test when Hamed-Rao has no p value.
export function mannKendallForAgreement(
  entry: TrendEntry | undefined,
): SignedTest | null {
  if (entry?.status !== "analyzed") return null;
  const hamedRao = entry.mann_kendall.hamed_rao as SignedTest;
  if (hamedRao.p !== null && hamedRao.significant !== null) return hamedRao;
  const seasonal = entry.mann_kendall.seasonal as SignedTest;
  if (seasonal.p !== null && seasonal.significant !== null) return seasonal;
  return null;
}

// Do the linear (OLS, lag-1 corrected) test and the Mann-Kendall test reach
// the same conclusion at the panel's level (p < alpha, before FDR)?
// bothSame: both significant in the same direction; bothNone: neither
// significant; disagree: only one is, or they point in opposite directions.
export function agreement(entry: TrendEntry | undefined): Agreement {
  if (entry?.status !== "analyzed") return "unknown";
  const mk = mannKendallForAgreement(entry);
  if (!mk || entry.ols.significant === null) return "unknown";
  const linear = entry.ols.significant;
  const rank = mk.significant === true;
  if (!linear && !rank) return "bothNone";
  if (linear && rank) {
    const slope = Math.sign(entry.ols.slope_per_decade);
    const z = Math.sign(mk.z ?? entry.sen.slope_per_decade);
    return slope === z ? "bothSame" : "disagree";
  }
  return "disagree";
}

export type FdrFamily = { scope: "core" | "world"; size: number };

// Which Benjamini-Hochberg family a series' q values come from: the world
// subset is its own family; everything else is the core run.
export function fdrFamily(
  key: string,
  worldKeys: Set<string>,
  sizes: { core: number; world: number },
): FdrFamily {
  return worldKeys.has(key)
    ? { scope: "world", size: sizes.world }
    : { scope: "core", size: sizes.core };
}
