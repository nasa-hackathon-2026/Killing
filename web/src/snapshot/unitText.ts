// Display-only typesetting for unit exponents. Spoken lines and aria-labels
// keep the plain unit string; this only splits a display string so the page
// can raise the exponent the way LaTeX would (cm^2, m-2, s-1, kg/m2).
// Scientific notation (e-7) and dates (2001-01) stay plain text. These units
// are exponents only, so the page does not embed a TeX engine.

export type UnitSegment =
  { kind: "text"; text: string } | { kind: "sup"; text: string };

const UNIT_BASE = "cm|mm|km|m|s";

function exponentPattern(): RegExp {
  return new RegExp(
    String.raw`([A-Za-zµμ°]+)\^(-?\d+)|(?<![A-Za-z])(?:${UNIT_BASE})(-[1-9]\d*)(?![A-Za-z0-9])|(?<=\/)(?:${UNIT_BASE})([1-9]\d*)(?![A-Za-z0-9])`,
    "g",
  );
}

function superscript(raw: string): string {
  const negative = raw.startsWith("-");
  return `${negative ? "−" : ""}${negative ? raw.slice(1) : raw}`;
}

function pushText(segments: UnitSegment[], text: string) {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.kind === "text") previous.text += text;
  else segments.push({ kind: "text", text });
}

// `cm^2` → cm + ², `m-2` → m + ⁻², `kg/m2` → kg/m + ². Anything else is text.
export function typesetUnits(text: string): UnitSegment[] {
  const segments: UnitSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(exponentPattern())) {
    const index = match.index ?? 0;
    pushText(segments, text.slice(cursor, index));
    const caretBase = match[1];
    const caretExp = match[2];
    if (caretBase !== undefined && caretExp !== undefined) {
      pushText(segments, caretBase);
      segments.push({ kind: "sup", text: superscript(caretExp) });
    } else {
      const whole = match[0];
      const exp = match[3] ?? match[4] ?? "";
      pushText(segments, whole.slice(0, whole.length - exp.length));
      segments.push({ kind: "sup", text: superscript(exp) });
    }
    cursor = index + match[0].length;
  }
  pushText(segments, text.slice(cursor));
  return segments.length > 0 ? segments : [{ kind: "text", text: "" }];
}
