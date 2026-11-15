// The browser's own voice (Web Speech API). No sound file is shipped.
// The voice follows the interface language and, within that language, the
// most human-sounding installed voice (speechVoice.ts). Pitch stays at 1:
// novelty voices that shift pitch are not selected. If the browser has no
// speech synthesis, nothing is spoken and the button is not shown.
import {
  currentSpeechLocale,
  speechLangTag,
  type SpeechLocale,
} from "../i18n/locale";
import { voiceForLocale } from "./speechVoice";

let request = 0;
let primed = false;
let remembered: SpeechSynthesisVoice[] = [];

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
  if (!speechAvailable() || primed) return;
  primed = true;
  const synth = window.speechSynthesis;
  const take = () => {
    const voices = synth.getVoices();
    if (voices.length > 0) remembered = voices;
  };
  take();
  synth.addEventListener("voiceschanged", take);
}

function voicesNow(): SpeechSynthesisVoice[] {
  const live = window.speechSynthesis.getVoices();
  if (live.length > 0) {
    remembered = live;
    return live;
  }
  return remembered;
}

export function stopSpeaking(): void {
  request += 1;
  if (speechAvailable()) window.speechSynthesis.cancel();
}

// Says `text` in `locale`, replacing anything still being spoken.
export function speak(
  text: string,
  locale: SpeechLocale = currentSpeechLocale(),
): void {
  if (!speechAvailable()) return;
  const spoken = text.trim();
  if (!spoken) return;
  primeSpeech();
  const token = ++request;
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(spoken);
  // A missing language pack must not fall through to the operating
  // system's default voice: on a Chinese system that voice reads
  // English with the wrong pitch. English is the fallback voice.
  const chosen = voiceForLocale(voicesNow(), locale);
  utterance.lang = chosen?.lang ?? speechLangTag(locale);
  if (chosen) utterance.voice = chosen.voice;
  utterance.pitch = 1;
  utterance.rate = 1;
  const say = () => {
    if (token !== request) return;
    synth.speak(utterance);
  };
  // Chrome drops an utterance that starts in the same turn as cancel().
  if (synth.speaking || synth.pending) {
    synth.cancel();
    window.setTimeout(say, 50);
  } else {
    say();
  }
}
