import { monthYearParts } from "../i18n";
// Month arithmetic and playback steps of the timeline. Months are the
// snapshot's "YYYY-MM-01" strings; pure functions only.

// Months per second. The slider, the − / + buttons and the number box all
// move in SPEED_STEP; 12 plays a year per second, so 2001–2026 runs in about
// half a minute.
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 12;
export const SPEED_STEP = 0.5;
export const DEFAULT_SPEED = 2;

// A typed or computed speed as an allowed one: rounded to the nearest step
// and kept inside the range; null when it is not a number.
export function clampSpeed(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const stepped = Math.round(value / SPEED_STEP) * SPEED_STEP;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, stepped));
}

// Milliseconds the player waits before advancing one month.
export function playIntervalMs(monthsPerSecond: number): number {
  return 1000 / monthsPerSecond;
}

// Months since year 0, so two months can be subtracted.
export function monthNumber(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

export function monthFromNumber(value: number): string {
  const year = Math.floor(value / 12);
  const month = value - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return -1;
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(index)));
}

// The index playback moves to next; null at the last month (playback stops).
export function nextPlayIndex(index: number, count: number): number | null {
  if (count <= 0 || index < 0 || index >= count - 1) return null;
  return index + 1;
}

// "?month=2015-07" (or a full "2015-07-01") as the snapshot's month string;
// null when it is not a month.
export function parseMonthParam(text: string | null): string | null {
  if (text === null) return null;
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(text.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}-01`;
}

// The month the timeline shows: the chosen one when the place has it,
// otherwise the fallback, otherwise the last month.
export function resolveMonth(
  months: string[],
  chosen: string | null,
  fallback: string | null,
): string | null {
  if (chosen && months.includes(chosen)) return chosen;
  if (fallback && months.includes(fallback)) return fallback;
  return months.at(-1) ?? null;
}

// The month and year in the active language's order, split so the year can be
// bold: "Jun 2025" (en), "2025 年 6 月" (zh-TW), "2025年6月" (ja).
export function monthLabel(month: string): { text: string; year: boolean }[] {
  return monthYearParts(month, "short");
}
