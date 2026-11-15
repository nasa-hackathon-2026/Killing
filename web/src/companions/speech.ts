// The browser's own voice (Web Speech API). No sound file is shipped. If the
// browser has no speech synthesis, nothing is spoken and the button is not
// shown.
import { getLocale, SPEECH_LANG } from "../i18n";

export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

export function stopSpeaking(): void {
  if (speechAvailable()) window.speechSynthesis.cancel();
}

// The voice to use for a language tag ("zh-TW"): the same tag, else the same
// primary language, else none.
export function pickVoice<T extends { lang: string }>(
  voices: readonly T[],
  tag: string,
): T | null {
  const wanted = tag.toLowerCase().replace("_", "-");
  const primary = wanted.split("-")[0] ?? wanted;
  const lang = (voice: T) => voice.lang.toLowerCase().replace("_", "-");
  return (
    voices.find((voice) => lang(voice) === wanted) ??
    voices.find((voice) => lang(voice).split("-")[0] === primary) ??
    null
  );
}

// Says `text` in the active language, replacing anything still being
// spoken. When the browser lists voices and none is in that language,
// nothing is said (an English voice reading Chinese text helps nobody).
export function speak(text: string): void {
  if (!speechAvailable()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const tag = SPEECH_LANG[getLocale()];
    const voices = synth.getVoices();
    const voice = pickVoice(voices, tag);
    if (!voice && voices.length > 0 && getLocale() !== "en") return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = tag;
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    synth.speak(utterance);
  } catch {
    // Speech is optional: a browser that refuses stays silent.
  }
}
