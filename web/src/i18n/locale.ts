// The five interface languages (#131). English is the default and the
// fallback. The companion voice reads this same choice: ?lang= wins over
// localStorage, and a missing or unknown value stays English.

export const SPEECH_LOCALES = ["en", "zh-TW", "ja", "de", "fr"] as const;

export type SpeechLocale = (typeof SPEECH_LOCALES)[number];

export const LANG_STORAGE_KEY = "estd.lang";

// Regional tags tried from the most specific voice to a same-language
// fallback. A voice whose language is not in this list is never used.
export const SPEECH_LANG_TAGS: Record<SpeechLocale, readonly string[]> = {
  en: ["en-US", "en-GB", "en-AU", "en"],
  "zh-TW": ["zh-TW", "zh-HK", "zh-Hant", "zh", "zh-CN"],
  ja: ["ja-JP", "ja"],
  de: ["de-DE", "de-AT", "de"],
  fr: ["fr-FR", "fr-CA", "fr"],
};

export const SPEECH_LOCALE_NAME: Record<SpeechLocale, string> = {
  en: "English",
  "zh-TW": "Traditional Chinese",
  ja: "Japanese",
  de: "German",
  fr: "French",
};

export function speechLangTag(locale: SpeechLocale): string {
  return SPEECH_LANG_TAGS[locale][0] ?? "en-US";
}

// Accepts "zh-TW", "zh_TW", "ja-JP", "de". zh-CN is a different written
// language and is not mapped onto zh-TW.
export function parseSpeechLocale(
  value: string | null | undefined,
): SpeechLocale | null {
  if (value == null) return null;
  const text = value.trim().replace(/_/g, "-");
  if (!text) return null;
  const exact = SPEECH_LOCALES.find(
    (locale) => locale.toLowerCase() === text.toLowerCase(),
  );
  if (exact) return exact;
  if (/^zh-(?:cn|sg|hans)(?:-|$)/i.test(text)) return null;
  const primary = text.split("-")[0]?.toLowerCase() ?? "";
  if (primary === "en") return "en";
  if (primary === "zh") return "zh-TW";
  if (primary === "ja") return "ja";
  if (primary === "de") return "de";
  if (primary === "fr") return "fr";
  return null;
}

// The address wins, then the saved choice, then English.
export function resolveSpeechLocale(
  search: string,
  stored: string | null,
): SpeechLocale {
  const query = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).get("lang");
  return parseSpeechLocale(query) ?? parseSpeechLocale(stored) ?? "en";
}

export function currentSpeechLocale(): SpeechLocale {
  if (typeof window === "undefined") return "en";
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    // Private mode and some embeds block storage. The address still applies.
  }
  return resolveSpeechLocale(window.location.search, stored);
}
