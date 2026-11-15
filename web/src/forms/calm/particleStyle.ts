// Which particle style the globe draws. "lively" is the original one:
// particles all around the Earth. "calm" gathers each layer into one small
// countable cluster above the selected place (see calmMath.ts).
//
// The choice comes from ?particles=calm|lively, then from what the reader
// picked before (localStorage), then from DEFAULT_PARTICLE_STYLE.
import { useSyncExternalStore } from "react";
import { requestedParticles } from "../../urlParams";

export type ParticleStyle = "calm" | "lively";

// The style a first-time visitor gets. Change this one constant to switch
// the default.
export const DEFAULT_PARTICLE_STYLE: ParticleStyle = "calm";

export const PARTICLE_STYLE_KEY = "estd-particle-style";

export function parseParticleStyle(
  text: string | null | undefined,
): ParticleStyle | null {
  return text === "calm" || text === "lively" ? text : null;
}

// Pure: the link wins over the stored choice, which wins over the default.
export function resolveParticleStyle(
  fromUrl: string | null | undefined,
  stored: string | null | undefined,
): ParticleStyle {
  return (
    parseParticleStyle(fromUrl) ??
    parseParticleStyle(stored) ??
    DEFAULT_PARTICLE_STYLE
  );
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(PARTICLE_STYLE_KEY);
  } catch {
    return null;
  }
}

let current: ParticleStyle | null = null;
const listeners = new Set<() => void>();

function snapshot(): ParticleStyle {
  if (current === null) {
    current =
      typeof window === "undefined"
        ? DEFAULT_PARTICLE_STYLE
        : resolveParticleStyle(requestedParticles(), readStored());
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setParticleStyle(style: ParticleStyle): void {
  current = style;
  try {
    window.localStorage.setItem(PARTICLE_STYLE_KEY, style);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
  for (const listener of listeners) listener();
}

// The same value in every component, inside and outside the canvas.
export function useParticleStyle(): ParticleStyle {
  return useSyncExternalStore(
    subscribe,
    snapshot,
    () => DEFAULT_PARTICLE_STYLE,
  );
}
