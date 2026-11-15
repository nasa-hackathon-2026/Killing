import type { Locale } from "../i18n/core";
import { voiceForLocale } from "./speechVoice";

let request = 0;
const primed = new WeakSet<SpeechSynthesis>();
const remembered = new WeakMap<SpeechSynthesis, SpeechSynthesisVoice[]>();

export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

// Chrome's voice list is empty until voiceschanged. Asking once at startup
// means a later click can speak inside the user gesture.
export function primeSpeech(): void {
  if (!speechAvailable()) return;
  const synth = window.speechSynthesis;
  if (primed.has(synth)) return;
  primed.add(synth);
  const take = () => {
    const voices = synth.getVoices();
    if (voices.length > 0) remembered.set(synth, voices);
  };
  take();
  synth.addEventListener("voiceschanged", take);
}

function voicesNow(): SpeechSynthesisVoice[] {
  const synth = window.speechSynthesis;
  const live = synth.getVoices();
  if (live.length > 0) {
    remembered.set(synth, live);
    return live;
  }
  return remembered.get(synth) ?? [];
}

export function stopSpeaking(): void {
  request += 1;
  try {
    if (speechAvailable()) window.speechSynthesis.cancel();
  } catch {
    request += 1;
  }
}

export function speak(text: string, locale: Locale): void {
  if (!speechAvailable()) return;
  try {
    const spoken = text.trim();
    if (!spoken) return;
    primeSpeech();
    const synth = window.speechSynthesis;
    const chosen = voiceForLocale(voicesNow(), locale);
    if (!chosen) {
      stopSpeaking();
      return;
    }

    const token = ++request;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = chosen.lang;
    utterance.voice = chosen.voice;
    utterance.pitch = 1;
    utterance.rate = 1;
    const say = () => {
      if (token === request) synth.speak(utterance);
    };
    if (synth.speaking || synth.pending) {
      synth.cancel();
      window.setTimeout(say, 50);
    } else {
      say();
    }
  } catch {
    request += 1;
  }
}
