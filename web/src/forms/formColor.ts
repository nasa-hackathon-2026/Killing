// Which of a variable's two existing colors its particles are drawn in.
// Several `particleColor`s are close to white, so with many layers open the
// forms could not be told apart; those use the variable's `glassColor`
// instead. No new palette: both colors come from src/mock/snapshot.ts.
export const PALE_LIGHTNESS = 0.8;

// HSL lightness of a "#rrggbb" color, 0..1. Unknown input reads as 0.
export function lightness(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return 0;
  const number = Number.parseInt(match[1], 16);
  const channels = [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  return (Math.max(...channels) + Math.min(...channels)) / 510;
}

export function formColor(colors: {
  glassColor: string;
  particleColor: string;
}): string {
  return lightness(colors.particleColor) > PALE_LIGHTNESS
    ? colors.glassColor
    : colors.particleColor;
}
