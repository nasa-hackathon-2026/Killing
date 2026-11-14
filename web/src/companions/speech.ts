// The browser's own voice (Web Speech API). No sound file is shipped. If the
// browser has no speech synthesis, nothing is spoken and the button is not
// shown.
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

// Says `text` in English, replacing anything still being spoken.
export function speak(text: string): void {
  if (!speechAvailable()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  const voice = synth
    .getVoices()
    .find((item) => item.lang.toLowerCase().startsWith("en"));
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  synth.speak(utterance);
}
