// THE ROLE TABLE. The switch in the top bar picks who is reading; each role
// is a preset of what the page shows by default. Wording comes in two voices
// only (general, expert); a role never changes a number.
import { ROLE_VOICE, type Role, type Voice } from "./core";

export type RoleSettings = {
  // Which wording the role reads.
  voice: Voice;
  // The one-sentence definition under each variable in the Layers panel.
  definitions: boolean;
  // The short "how to read the marks" note in the Layers panel.
  readingAid: boolean;
  // Statistics are shown in full instead of folded under "Details".
  fullStatistics: boolean;
  // The companion tour starts by itself on a first visit.
  autoTour: boolean;
  // Companions speak up when a layer is turned on, the place changes or the
  // timeline pauses (the visitor can still switch it either way).
  narration: boolean;
};

export const ROLE_SETTINGS: Record<Role, RoleSettings> = {
  // Anyone, children included: the fewest words.
  everyone: {
    voice: ROLE_VOICE.everyone,
    definitions: false,
    readingAid: false,
    fullStatistics: false,
    autoTour: true,
    narration: true,
  },
  // Plain words plus the learning aids.
  student: {
    voice: ROLE_VOICE.student,
    definitions: true,
    readingAid: true,
    fullStatistics: false,
    autoTour: false,
    narration: true,
  },
  // Every statistic and its term.
  researcher: {
    voice: ROLE_VOICE.researcher,
    definitions: true,
    readingAid: true,
    fullStatistics: true,
    autoTour: false,
    narration: false,
  },
};

export function roleSettings(role: Role): RoleSettings {
  return ROLE_SETTINGS[role];
}
