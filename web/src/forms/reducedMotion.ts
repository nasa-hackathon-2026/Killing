// The system "reduce motion" setting. Animations multiply their time step by
// motionScale(): 0 when the user asked for less motion, 1 otherwise.
const QUERY = "(prefers-reduced-motion: reduce)";

let cached: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (cached !== null) return cached;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  const media = window.matchMedia(QUERY);
  cached = media.matches;
  media.addEventListener("change", (event) => {
    cached = event.matches;
  });
  return cached;
}

export function motionScale(): number {
  return prefersReducedMotion() ? 0 : 1;
}
