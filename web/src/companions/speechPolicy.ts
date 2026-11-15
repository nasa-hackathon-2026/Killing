export type SpeechDecision = {
  voiceOn: boolean;
  playing: boolean;
  wasPlaying: boolean;
  voiceAvailable: boolean;
  key: string | null;
  spokenFor: string | null;
};

export function shouldSpeakLine(decision: SpeechDecision): boolean {
  return (
    decision.voiceOn &&
    decision.voiceAvailable &&
    !decision.playing &&
    decision.key !== null &&
    (decision.wasPlaying || decision.key !== decision.spokenFor)
  );
}
