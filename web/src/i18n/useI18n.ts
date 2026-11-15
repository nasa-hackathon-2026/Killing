import { useSyncExternalStore } from "react";
import {
  getLocale,
  getRole,
  getVersion,
  getVoice,
  subscribe,
  t,
  tm,
  type Locale,
  type Role,
  type Voice,
} from "./core";
import { roleSettings, type RoleSettings } from "./roles";

// Re-renders the component when the language or the role changes. `t` and
// `tm` are the same functions as in core.ts; calling this hook is what makes
// their result fresh. `mode` is the older two-way name of the voice
// ("general" or "research").
export function useI18n(): {
  t: typeof t;
  tm: typeof tm;
  locale: Locale;
  role: Role;
  voice: Voice;
  settings: RoleSettings;
  mode: "general" | "research";
} {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  const voice = getVoice();
  return {
    t,
    tm,
    locale: getLocale(),
    role: getRole(),
    voice,
    settings: roleSettings(getRole()),
    mode: voice === "expert" ? "research" : "general",
  };
}
