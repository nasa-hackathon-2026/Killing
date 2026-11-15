// The one place the layer view gets its "data companion" from: the original
// characters of web/src/companions/. Which stratum a companion stands on
// stays in strataSpec.ts (companionSpec.ts reads its `layer` and height
// order from there, so there is one table).
import { Companion } from "../companions/Companion";
import type { TrendSignal } from "../forms/encoding";

export type CompanionSlotProps = {
  variableId: string;
  // Normalized reading of the month, 0..1; null when the month has no data.
  value: number | null;
  // Standardized anomaly of the month against the same calendar month.
  anomalyZ?: number | null;
  // The same trend signal as the layer panel, so the mark is the same.
  signal?: TrendSignal;
  // Pixels.
  size: number;
};

export function CompanionSlot({
  variableId,
  value,
  anomalyZ,
  signal,
  size,
}: CompanionSlotProps) {
  return (
    <Companion
      variableId={variableId}
      value={value}
      anomalyZ={anomalyZ ?? null}
      signal={signal}
      size={size}
      showLabel={false}
    />
  );
}
