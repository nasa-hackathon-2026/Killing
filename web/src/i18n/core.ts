// The message store behind every text on the pages: which language and
// which reader mode are active, the dictionaries, and the lookup. No React
// and no file loading here (see index.ts), so pure functions and tests can
// use it directly.
//
// Keys are "<namespace>.<path>": the namespace is the file
// (locales/<lang>/<namespace>.json), the path is the nested key inside it.
// A key missing in the active language falls back to English.

export const LOCALES = ["en", "zh-TW", "ja", "de", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

// Each language under its own name, for the language menu.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  "zh-TW": "繁體中文",
  ja: "日本語",
  de: "Deutsch",
  fr: "Français",
};

// The voice the browser is asked for when a companion speaks.
export const SPEECH_LANG: Record<Locale, string> = {
  en: "en-US",
  "zh-TW": "zh-TW",
  ja: "ja-JP",
  de: "de-DE",
  fr: "fr-FR",
};

// Who is reading. A role is a preset (roles.ts): which wording it reads and
// what is open by default. There are only two wordings ("voices"): `general`
// in plain words and `expert` with the statistical terms. All roles show the
// same numbers.
export const ROLES = ["everyone", "student", "researcher"] as const;
export type Role = (typeof ROLES)[number];
export const DEFAULT_ROLE: Role = "everyone";
export type Voice = "general" | "expert";
export const ROLE_VOICE: Record<Role, Voice> = {
  everyone: "general",
  student: "general",
  researcher: "expert",
};

export type Vars = Record<string, string | number>;
export type MessageTree = { [key: string]: string | MessageTree };

const dictionaries = new Map<Locale, Map<string, string>>();
let locale: Locale = DEFAULT_LOCALE;
let role: Role = DEFAULT_ROLE;
let version = 0;
const listeners = new Set<() => void>();

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}

// { a: { b: "x" } } under namespace "ns" -> "ns.a.b": "x".
export function flattenMessages(
  namespace: string,
  tree: MessageTree,
  into: Map<string, string> = new Map(),
): Map<string, string> {
  for (const [key, value] of Object.entries(tree)) {
    const path = `${namespace}.${key}`;
    if (typeof value === "string") into.set(path, value);
    else flattenMessages(path, value, into);
  }
  return into;
}

// Adds the namespaces of one language. Files whose name starts with "_"
// (translator notes) are not messages and must not be passed in.
export function registerMessages(
  target: Locale,
  namespaces: Record<string, MessageTree>,
): void {
  const flat = dictionaries.get(target) ?? new Map<string, string>();
  for (const [namespace, tree] of Object.entries(namespaces)) {
    flattenMessages(namespace, tree, flat);
  }
  dictionaries.set(target, flat);
}

export function hasMessages(target: Locale): boolean {
  return dictionaries.has(target);
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Changes whenever the language or the mode does (for useSyncExternalStore).
export function getVersion(): number {
  return version;
}

export function getLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  formatters.clear();
  notify();
}

export function getRole(): Role {
  return role;
}

export function setRole(next: Role): void {
  if (next === role) return;
  role = next;
  notify();
}

// The wording the active role reads.
export function getVoice(): Voice {
  return ROLE_VOICE[role];
}

function lookup(key: string): string | undefined {
  return (
    dictionaries.get(locale)?.get(key) ??
    dictionaries.get(DEFAULT_LOCALE)?.get(key)
  );
}

export function hasMessage(key: string): boolean {
  return lookup(key) !== undefined;
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

// The message of `key` in the active language, else in English. A key that
// exists nowhere is a bug the key test catches; the last word of the key is
// shown rather than a blank.
export function t(key: string, vars?: Vars): string {
  const template = lookup(key);
  if (template === undefined) return key.slice(key.lastIndexOf(".") + 1);
  return interpolate(template, vars);
}

// The same, or null when no language has the key (optional messages such as
// the name of a place added to the catalog later).
export function tOptional(key: string, vars?: Vars): string | null {
  const template = lookup(key);
  return template === undefined ? null : interpolate(template, vars);
}

// A message with one wording per voice: reads `<key>.general` or
// `<key>.expert`, by default for the active role.
export function tm(
  key: string,
  vars?: Vars,
  voice: Voice = getVoice(),
): string {
  return t(`${key}.${voice}`, vars);
}

// ---- Numbers and dates ---------------------------------------------------

const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function decimalSeparator(): string {
  const key = "decimal";
  let format = formatters.get(key) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(locale);
    formatters.set(key, format);
  }
  return (
    format.formatToParts(1.5).find((part) => part.type === "decimal")?.value ??
    "."
  );
}

// A number already written with a decimal point ("0.21", "1.2e-6", "+3.5 K")
// in the active language's convention: German and French use a comma. The
// digits are untouched, so both reader modes and every language show the
// same value. Units are not translated.
export function localNumber(text: string): string {
  const separator = decimalSeparator();
  if (separator === ".") return text;
  return text.replace(/(\d)\.(\d)/g, `$1${separator}$2`);
}

// An integer with the language's thousands separator (counts of months,
// series, cells).
export function formatCount(value: number): string {
  const key = "count";
  let format = formatters.get(key) as Intl.NumberFormat | undefined;
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    formatters.set(key, format);
  }
  return format.format(value);
}

function dateFormat(
  key: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let format = formatters.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, format);
  }
  return format;
}

function monthDate(month: string): Date | null {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  if (!Number.isInteger(year) || !(index >= 0 && index < 12)) return null;
  return new Date(Date.UTC(year, index, 1));
}

// "2024-06" or "2024-06-01" -> "June" / "Jun" in the active language.
export function monthName(
  month: string,
  width: "long" | "short" = "long",
): string {
  const date = monthDate(month);
  if (!date) return month.slice(5, 7);
  return dateFormat(`month-${width}`, { month: width }).format(date);
}

// "2024-06-01" -> "June 2024" (en), "2024年6月" (zh-TW, ja), "Juni 2024" (de).
export function monthYear(
  month: string,
  width: "long" | "short" = "long",
): string {
  const date = monthDate(month);
  if (!date) return month.slice(0, 7);
  return dateFormat(`month-year-${width}`, {
    month: width,
    year: "numeric",
  }).format(date);
}
