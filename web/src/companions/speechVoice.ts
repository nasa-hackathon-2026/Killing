// Picks the highest-quality installed browser voice matching the text language.
// Region preference breaks ties between voices of comparable quality.
import { SPEECH_LANG, type Locale } from "../i18n/core";

export type VoiceCandidate = {
  name: string;
  lang: string;
};

const VOICE_LANG_TAGS: Record<Locale, readonly string[]> = {
  en: [SPEECH_LANG.en, "en-GB", "en-AU", "en"],
  "zh-TW": [SPEECH_LANG["zh-TW"], "zh-HK", "zh-Hant", "zh", "zh-CN"],
  ja: [SPEECH_LANG.ja, "ja"],
  de: [SPEECH_LANG.de, "de-AT", "de"],
  fr: [SPEECH_LANG.fr, "fr-CA", "fr"],
};

const HUMAN_MARKS: readonly [RegExp, number][] = [
  [/natural/i, 80],
  [/neural/i, 70],
  [/wavenet/i, 60],
  [/premium/i, 50],
  [/enhanced/i, 40],
  [/google/i, 30],
];

const ROBOTIC =
  /espeak|festival|festvox|\bcompact\b|bad news|bells|boing|bubbles|cellos|zarvox|whisper|trinoids|superstar|\balbert\b|bahh|deranged|hysterical|pipe organ|junior/i;

function canonicalLang(lang: string): string {
  return lang.trim().replace(/_/g, "-").toLowerCase();
}

function humanBonus(name: string): number {
  for (const [pattern, bonus] of HUMAN_MARKS) {
    if (pattern.test(name)) return bonus;
  }
  return 0;
}

function tagIndex(lang: string, locale: Locale): number | null {
  const voiceLang = canonicalLang(lang);
  if (!voiceLang) return null;
  const tags = VOICE_LANG_TAGS[locale];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = canonicalLang(tags[index] ?? "");
    if (voiceLang === tag || voiceLang.startsWith(`${tag}-`)) return index;
  }
  return null;
}

function voiceScore(voice: VoiceCandidate, locale: Locale): number {
  const index = tagIndex(voice.lang, locale);
  if (index === null) return 0;
  const regionalPreference = (VOICE_LANG_TAGS[locale].length - index) * 100;
  const quality = humanBonus(voice.name) * 1000;
  return quality + regionalPreference - (ROBOTIC.test(voice.name) ? 50000 : 0);
}

export function chooseVoice<T extends VoiceCandidate>(
  voices: readonly T[],
  locale: Locale,
): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const score = voiceScore(voice, locale);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

export function voiceForLocale<T extends VoiceCandidate>(
  voices: readonly T[],
  locale: Locale,
): { voice: T; lang: string } | null {
  const voice = chooseVoice(voices, locale);
  return voice ? { voice, lang: voice.lang } : null;
}
