import { describe, expect, it } from "vitest";
import { closeUps } from "./closeUps";
import {
  labelingPainter,
  MAX_CLOSEUP_LABELS,
  MAX_LABELS_PER_KIND,
  PHOTON_LABEL,
  type CloseUpLabel,
} from "./labels";
import { GRAIN_COLOR, PHOTON_COLOR, scripts, type Painter } from "./scripts";

function recorder() {
  const calls: string[] = [];
  const painter: Painter = {
    molecule: (id) => calls.push(`molecule:${id}`),
    solid: () => calls.push("solid"),
    blob: () => calls.push("blob"),
  };
  return { calls, painter };
}

describe("labelingPainter", () => {
  it("passes every call through and labels molecules with their formula", () => {
    const { calls, painter } = recorder();
    const labels: CloseUpLabel[] = [];
    const paint = labelingPainter(painter, labels);
    paint.molecule("NO2", 1, 2, 0, 0);
    paint.molecule("O3", -1, 0, 0, 0, 1);
    paint.blob(0, 0, 0, 1);
    expect(calls).toEqual(["molecule:NO2", "molecule:O3", "blob"]);
    expect(labels.map((label) => label.text)).toEqual(["NO₂", "O₃"]);
    expect(labels[0].x).toBe(1);
    expect(labels[0].y).toBeGreaterThan(2);
  });

  it("labels photons but not soil grains", () => {
    const labels: CloseUpLabel[] = [];
    const paint = labelingPainter(recorder().painter, labels);
    paint.solid(0, 0, 0, 0.07, PHOTON_COLOR);
    paint.solid(1, 0, 0, 0.4, GRAIN_COLOR);
    expect(labels.map((label) => label.text)).toEqual([PHOTON_LABEL]);
  });

  it("skips molecules that are still fading in", () => {
    const { calls, painter } = recorder();
    const labels: CloseUpLabel[] = [];
    labelingPainter(painter, labels).molecule("H2O", 0, 0, 0, 0, 0.1);
    expect(calls).toEqual(["molecule:H2O"]);
    expect(labels).toEqual([]);
  });

  it("labels only the first few of one kind", () => {
    const labels: CloseUpLabel[] = [];
    const paint = labelingPainter(recorder().painter, labels);
    for (let index = 0; index < 50; index += 1) {
      paint.molecule("N2", index, 0, 0, 0);
    }
    expect(labels).toHaveLength(MAX_LABELS_PER_KIND);
  });

  it("gives every close-up at least one label and stays under the cap", () => {
    for (const view of closeUps) {
      if (view.molecules.length === 0) continue;
      let most = 0;
      for (const time of [0, 1.3, 2.7, 4.1, 6.5, 8.2]) {
        const labels: CloseUpLabel[] = [];
        scripts[view.id](
          { time, value: 0.6, kelvin: 300 },
          labelingPainter(recorder().painter, labels),
        );
        expect(labels.length).toBeLessThanOrEqual(MAX_CLOSEUP_LABELS);
        most = Math.max(most, labels.length);
      }
      expect(most, view.id).toBeGreaterThan(0);
    }
  });
});
