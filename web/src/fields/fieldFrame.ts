// Per-frame values the global distribution shares with the rest of the scene.
// GlobalField writes them in its useFrame; LocalParticlesBlend reads them.
// Plain mutable state on purpose: it changes every frame and must not
// re-render React.
export const fieldFrame = {
  // Multiplier on the place's particles (1 = unchanged; always 1 while the
  // global distribution is off).
  local: 1,
};
