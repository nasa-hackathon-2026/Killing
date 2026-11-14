// The one place the layer view gets its "data companion" from.
//
// ADAPTER: this is a placeholder (a labeled circle). Once the companions
// (web/src/companions/) are merged, replace the body of CompanionSlot with
//   <Companion variableId={variableId} value={value} anomalyZ={anomalyZ}
//     trend={trend} significant={significant} size={size} />
// (import { Companion } from "../companions/Companion") and delete
// placeholderColor(). The props below already match that component. The
// layer a companion stands on stays in strataSpec.ts; companionFor()'s
// `layer` / `altitudeOrder` can be checked against it in a test.
import { formColor } from "../forms/formColor";
import { layerRegistry } from "../layers/registry";

export type CompanionSlotProps = {
  variableId: string;
  // Normalized reading of the month, 0..1 (0 when there is no data).
  value: number;
  // Standardized anomaly of the month; not available yet.
  anomalyZ?: number;
  // +1 rising, -1 falling, 0 otherwise (trendArrowDirection).
  trend: number;
  significant: boolean;
  // Pixels.
  size: number;
};

function placeholderColor(variableId: string): string {
  const layer = layerRegistry.find((item) => item.id === variableId);
  return layer ? formColor(layer) : "#b7c6da";
}

export function CompanionSlot({
  variableId,
  trend,
  significant,
  size,
}: CompanionSlotProps) {
  const color = placeholderColor(variableId);
  const glyph = !significant ? "" : trend > 0 ? "▲" : trend < 0 ? "▼" : "";
  return (
    <span
      className="strata-companion-placeholder"
      style={{ width: size, height: size, background: color }}
      aria-hidden="true"
    >
      {glyph}
    </span>
  );
}
