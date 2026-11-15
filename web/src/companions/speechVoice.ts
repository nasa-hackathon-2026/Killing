// Picks one installed browser voice for an interface language.
//
// Language comes first: English is read by an English voice, and a Taiwan
// voice is kept ahead of a mainland one. Within that language, Natural,
// Neural, Premium and Google voices come ahead of eSpeak and the macOS
// novelty voices, whose pitch does not sound like a person.
import {
  SPEECH_LANG_TAGS,
  speechLangTag,
  type SpeechLocale,
} from "../i18n/locale";

export type VoiceCandidate = {
  name: string;
  lang: string;
};

// Higher is more human. The first match wins; these do not stack.
const HUMAN_MARKS: readonly [RegExp, number][] = [
  [/natural/i, 80],
  [/neural/i, 70],
  [/wavenet/i, 60],
  [/premium/i, 50],
  [/enhanced/i, 40],
  [/google/i, 30],
];

// eSpeak is a robotic default on Linux. The other names are macOS voices
// that shift pitch on purpose.
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

// The earliest tag that fits. "en-US" beats the bare "en" entry, and a
// voice of another language does not fit any tag.
function tagIndex(lang: string, locale: SpeechLocale): number | null {
  const voiceLang = canonicalLang(lang);
  if (!voiceLang) return null;
  const tags = SPEECH_LANG_TAGS[locale];
  for (let index = 0; index < tags.length; index += 1) {
    const tag = canonicalLang(tags[index] ?? "");
    if (voiceLang === tag || voiceLang.startsWith(`${tag}-`)) return index;
  }
  return null;
}

// Higher is a better voice. 0 means this voice cannot read the language.
function voiceScore(voice: VoiceCandidate, locale: SpeechLocale): number {
  const index = tagIndex(voice.lang, locale);
  if (index === null) return 0;
  const robotic = ROBOTIC.test(voice.name);
  return (100 - index) * 1000 + (robotic ? 0 : 500) + humanBonus(voice.name);
}

export function chooseVoice<T extends VoiceCandidate>(
  voices: readonly T[],
  locale: SpeechLocale,
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

// The voice to speak with. When the browser has no voice for `locale`,
// English is used so the operating system's default voice (often another
// language) does not read the sentence.
export function voiceForLocale<T extends VoiceCandidate>(
  voices: readonly T[],
  locale: SpeechLocale,
): { voice: T; lang: string } | null {
  const match = chooseVoice(voices, locale);
  if (match) return { voice: match, lang: speechLangTag(locale) };
  if (locale === "en") return null;
  const english = chooseVoice(voices, "en");
  if (!english) return null;
  return { voice: english, lang: speechLangTag("en") };
}

// The language the button should name: the requested one when a voice
// exists, otherwise English. An empty voice list has not loaded yet, so
// the requested language stays until the browser answers.
export function resolvedSpeechLocale(
  voices: readonly VoiceCandidate[],
  locale: SpeechLocale,
): SpeechLocale {
  if (voices.length === 0) return locale;
  if (chooseVoice(voices, locale)) return locale;
  if (locale !== "en" && chooseVoice(voices, "en")) return "en";
  return locale;
}
