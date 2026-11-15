import { typesetUnits } from "./unitTypeset";

// Renders `typesetUnits` for a measurement or a sentence that contains one.
// A string with no exponent is returned as text, so callers can use this on
// every reading without wrapping plain status messages in extra elements.
export function UnitText({ text }: { text: string }) {
  const segments = typesetUnits(text);
  if (segments.every((segment) => segment.kind === "text")) return text;
  return (
    <span className="unit-text">
      {segments.map((segment, index) =>
        segment.kind === "sup" ? (
          <sup key={index}>{segment.text}</sup>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
