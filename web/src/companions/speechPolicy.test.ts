import { describe, expect, it } from "vitest";
import { shouldSpeakLine } from "./speechPolicy";

describe("shouldSpeakLine", () => {
  const base = {
    voiceOn: true,
    playing: false,
    wasPlaying: false,
    voiceAvailable: true,
    key: "precipitation|taiwan|en|general",
    spokenFor: null as string | null,
  };

  it("speaks the latest line when playback pauses even if its key is unchanged", () => {
    expect(
      shouldSpeakLine({ ...base, wasPlaying: true, spokenFor: base.key }),
    ).toBe(true);
  });

  it("does not repeat the same line while paused", () => {
    expect(shouldSpeakLine({ ...base, spokenFor: base.key })).toBe(false);
  });

  it("waits until playback pauses", () => {
    expect(shouldSpeakLine({ ...base, playing: true, wasPlaying: true })).toBe(
      false,
    );
  });

  it("does not speak without a matching voice or selected companion", () => {
    expect(shouldSpeakLine({ ...base, voiceAvailable: false })).toBe(false);
    expect(shouldSpeakLine({ ...base, key: null })).toBe(false);
  });
});
