// Loading and choosing the language and the reader mode in the browser.
// English is bundled; each other language is one chunk fetched when it is
// first chosen. Messages live in locales/<lang>/<namespace>.json.
import {
  DEFAULT_LOCALE,
  DEFAULT_ROLE,
  getLocale,
  getRole,
  hasMessages,
  isLocale,
  isRole,
  LOCALES,
  registerMessages,
  setLocale,
  setRole,
  type Locale,
  type MessageTree,
  type Role,
} from "./core";
import { namespacesOf } from "./namespaces";

export * from "./core";
export { useI18n } from "./useI18n";

registerMessages(
  "en",
  namespacesOf(
    import.meta.glob<MessageTree>("./locales/en/*.json", {
      eager: true,
      import: "default",
    }),
  ),
);

const LOADERS: Record<
  Exclude<Locale, "en">,
  () => Promise<{ default: Record<string, MessageTree> }>
> = {
  "zh-TW": () => import("./bundles/zh-TW"),
  ja: () => import("./bundles/ja"),
  de: () => import("./bundles/de"),
  fr: () => import("./bundles/fr"),
};

export const LOCALE_STORAGE_KEY = "estd.lang";
export const ROLE_STORAGE_KEY = "estd.role";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function stored(key: string): string | null {
  try {
    return browserStore()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    browserStore()?.setItem(key, value);
  } catch {
    // Storage is blocked: the choice lasts for this page only.
  }
}

// A browser language tag mapped to a supported language: an exact match,
// any Chinese to zh-TW, otherwise the primary subtag ("de-AT" -> "de").
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const exact = LOCALES.find(
    (item) => item.toLowerCase() === tag.toLowerCase(),
  );
  if (exact) return exact;
  const primary = tag.toLowerCase().split("-")[0];
  if (primary === "zh") return "zh-TW";
  return LOCALES.find((item) => item === primary) ?? null;
}

// In order: ?lang=, the stored choice, the browser's languages, English.
export function detectLocale(
  search: string,
  storedValue: string | null,
  browserLanguages: readonly string[],
): Locale {
  const asked = matchLocale(new URLSearchParams(search).get("lang"));
  if (asked) return asked;
  if (isLocale(storedValue)) return storedValue;
  for (const tag of browserLanguages) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

// ?role=everyone|student|researcher, then the older ?mode= (research ->
// researcher, anything else -> everyone), then the stored choice.
export function detectRole(search: string, storedValue: string | null): Role {
  const params = new URLSearchParams(search);
  const asked = params.get("role");
  if (isRole(asked)) return asked;
  const mode = params.get("mode");
  if (mode !== null) return mode === "research" ? "researcher" : "everyone";
  if (isRole(storedValue)) return storedValue;
  return DEFAULT_ROLE;
}

async function load(locale: Locale): Promise<boolean> {
  if (hasMessages(locale)) return true;
  if (locale === "en") return true;
  try {
    registerMessages(locale, (await LOADERS[locale]()).default);
    return true;
  } catch {
    // The chunk could not be fetched: stay in the current language.
    return false;
  }
}

function applyDocumentLanguage(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

// Keeps a ?lang= or ?role= that is already in the address in step with the
// menu, so reloading or copying the link gives the same page.
function syncAddress(name: string, value: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.set(name, value);
  window.history.replaceState(null, "", url);
}

// Called once before the first render.
export async function initI18n(): Promise<void> {
  if (typeof window === "undefined") return;
  const search = window.location.search;
  setRole(detectRole(search, stored(ROLE_STORAGE_KEY)));
  const locale = detectLocale(
    search,
    stored(LOCALE_STORAGE_KEY),
    window.navigator.languages ?? [],
  );
  if (await load(locale)) setLocale(locale);
  applyDocumentLanguage(getLocale());
}

// The language menu: loads the language, switches without a reload and
// remembers the choice.
export async function chooseLocale(locale: Locale): Promise<void> {
  if (!(await load(locale))) return;
  setLocale(locale);
  remember(LOCALE_STORAGE_KEY, locale);
  applyDocumentLanguage(locale);
  syncAddress("lang", locale);
}

export function chooseRole(role: Role): void {
  setRole(role);
  remember(ROLE_STORAGE_KEY, role);
  if (typeof window !== "undefined") {
    // The older ?mode= would win over the new choice on reload.
    const url = new URL(window.location.href);
    if (url.searchParams.has("mode")) {
      url.searchParams.delete("mode");
      url.searchParams.set("role", role);
      window.history.replaceState(null, "", url);
    }
  }
  syncAddress("role", role);
}

// A choice kept in localStorage ("1" / "0"), or null when never made.
export function storedFlag(key: string): boolean | null {
  const value = stored(key);
  return value === "1" ? true : value === "0" ? false : null;
}

export function rememberFlag(key: string, value: boolean): void {
  remember(key, value ? "1" : "0");
}

// A link to another page of the site that keeps the language and the role:
// adds lang= when it is not English and role= when it is not the default.
export function carryChoices(href: string): string {
  const [path = "", hash] = href.split("#");
  const [base = "", query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (getLocale() !== DEFAULT_LOCALE) params.set("lang", getLocale());
  if (getRole() !== DEFAULT_ROLE) params.set("role", getRole());
  // Ids are plain ASCII; keep the commas of ?layers= readable.
  const text = params.toString().replace(/%2C/g, ",");
  return `${base}${text ? `?${text}` : ""}${hash !== undefined ? `#${hash}` : ""}`;
}
