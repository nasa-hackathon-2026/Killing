// Text labels for what a close-up draws. `labelingPainter` wraps a Painter,
// passes every call through and notes where a label belongs, so the scripts
// stay unaware of labels. Pure: no renderer and no DOM here.
import { molecules, type MoleculeId } from "../chemistry/molecules";
import { PHOTON_COLOR, type Painter } from "./scripts";

export const MAX_CLOSEUP_LABELS = 36;
// Crowded views (dozens of the same molecule) label only the first few of
// each kind; the rest are the same thing.
export const MAX_LABELS_PER_KIND = 6;
// A molecule that is still fading in or out is not labelled.
export const MIN_LABEL_SCALE = 0.5;

export const PHOTON_LABEL = "hν";

export type CloseUpLabel = {
  text: string;
  x: number;
  y: number;
  z: number;
};

export function moleculeLabel(id: MoleculeId): string {
  return molecules[id].formula;
}

// How far above a molecule's center its label sits (scene units).
export const LABEL_LIFT = 0.3;

export function labelingPainter(
  painter: Painter,
  labels: CloseUpLabel[],
): Painter {
  const perKind = new Map<string, number>();
  const add = (text: string, x: number, y: number, z: number) => {
    const used = perKind.get(text) ?? 0;
    if (used >= MAX_LABELS_PER_KIND) return;
    if (labels.length >= MAX_CLOSEUP_LABELS) return;
    perKind.set(text, used + 1);
    labels.push({ text, x, y, z });
  };
  return {
    molecule(id, x, y, z, rotation, scale = 1) {
      painter.molecule(id, x, y, z, rotation, scale);
      if (scale < MIN_LABEL_SCALE) return;
      add(moleculeLabel(id), x, y + LABEL_LIFT * scale, z);
    },
    solid(x, y, z, radius, color) {
      painter.solid(x, y, z, radius, color);
      if (color === PHOTON_COLOR) add(PHOTON_LABEL, x, y + radius + 0.12, z);
    },
    blob(x, y, z, radius) {
      painter.blob(x, y, z, radius);
    },
  };
}
