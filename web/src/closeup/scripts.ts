// What each close-up draws at a given time. Pure: a script only calls the
// painter it is given, so it can be tested without a renderer. Lengths are
// in scene units; one angstrom is ANGSTROM units for molecules.
import type { MoleculeId } from "../chemistry/molecules";
import type { CloseUpId, SceneKind } from "./closeUps";

export const ANGSTROM = 0.1;
// Atom spheres are drawn at this fraction of their van der Waals radius so
// the shape of the molecule stays readable.
export const ATOM_RADIUS_FRACTION = 0.6;

export const MAX_CLOSEUP_ATOMS = 400;
export const MAX_CLOSEUP_SOLIDS = 48;
export const MAX_CLOSEUP_BLOBS = 24;

export const PHOTON_COLOR = "#ffe45c";
export const GRAIN_COLOR = "#8a6a4a";

export type Painter = {
  molecule: (
    id: MoleculeId,
    x: number,
    y: number,
    z: number,
    rotation: number,
    scale?: number,
  ) => void;
  // An opaque ball: a photon (schematic) or a soil grain.
  solid: (
    x: number,
    y: number,
    z: number,
    radius: number,
    color: string,
  ) => void;
  // A translucent body of liquid water.
  blob: (x: number, y: number, z: number, radius: number) => void;
};

export type ScriptInput = {
  time: number;
  // Normalized reading, 0..1.
  value: number;
  // Absolute temperature for the thermal views; null when there is none.
  kelvin: number | null;
};

function fract(value: number): number {
  return value - Math.floor(value);
}

function unit(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Deterministic pseudo-random number in 0..1 for item `index`, stream `salt`.
export function noise(index: number, salt: number): number {
  return fract(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453);
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * unit(amount);
}

// 0 before `start`, 1 after `end`.
function stage(u: number, start: number, end: number): number {
  return unit((u - start) / (end - start));
}

// Reflects a growing coordinate back and forth between -half and +half.
function bounce(position: number, half: number): number {
  const span = half * 2;
  const folded = fract((position + half) / (span * 2)) * span * 2;
  return (folded < span ? folded : span * 2 - folded) - half;
}

function appear(u: number): number {
  return Math.min(stage(u, 0, 0.05), 1 - stage(u, 0.92, 1));
}

// How many lanes, drops or molecules a view shows for a value.
export function amountFor(value: number, least: number, most: number): number {
  return least + Math.round(unit(value) * (most - least));
}

// NO2 + hv -> NO + O, then O + O2 + M -> O3 + M.
function no2Photolysis({ time, value }: ScriptInput, paint: Painter) {
  const lanes = amountFor(value, 1, 4);
  for (let lane = 0; lane < lanes; lane += 1) {
    const y = (lane - (lanes - 1) / 2) * 1.05;
    const u = fract(time / 9 + lane * 0.27);
    const size = appear(u);
    const split = stage(u, 0.28, 0.3);
    const travel = stage(u, 0.3, 0.58);
    const joined = stage(u, 0.58, 0.6);
    if (u < 0.28) {
      const k = stage(u, 0.04, 0.28);
      paint.solid(
        mix(-2.9, -1.45, k),
        y + mix(1.0, 0.1, k),
        0,
        0.07,
        PHOTON_COLOR,
      );
    }
    if (split < 1) {
      paint.molecule("NO2", -1.3, y, 0, 0.3 * Math.sin(time + lane), size);
    } else {
      paint.molecule(
        "NO",
        mix(-1.3, -2.0, travel),
        y - 0.1 * travel,
        0,
        time * 0.6,
        size,
      );
      if (joined < 1)
        paint.molecule("O", mix(-1.05, 0.75, travel), y, 0, 0, size);
    }
    if (joined < 1) {
      paint.molecule("O2", 1.0, y, 0, 0.4 * Math.sin(time * 0.7 + lane), size);
    } else {
      paint.molecule(
        "O3",
        mix(1.0, 1.3, stage(u, 0.6, 1)),
        y,
        0,
        0.3 * Math.sin(time),
        size,
      );
    }
    // M: any air molecule that takes up the released energy and moves off.
    const away = stage(u, 0.58, 0.9);
    paint.molecule(
      "N2",
      mix(1.45, 2.7, away),
      y - mix(0.4, 0.8, away),
      0,
      time * (0.4 + away * 2),
      size,
    );
  }
}

// O2 + hv -> O + O, then O + O2 + M -> O3 + M on each side.
function ozoneChapman({ time, value }: ScriptInput, paint: Painter) {
  const lanes = amountFor(value, 1, 4);
  for (let lane = 0; lane < lanes; lane += 1) {
    const y = (lane - (lanes - 1) / 2) * 1.05;
    const u = fract(time / 9 + lane * 0.27);
    const size = appear(u);
    const split = stage(u, 0.28, 0.3);
    const travel = stage(u, 0.3, 0.58);
    const joined = stage(u, 0.58, 0.6);
    if (u < 0.28) {
      const k = stage(u, 0.04, 0.28);
      paint.solid(
        mix(-1.2, -0.12, k),
        y + mix(1.1, 0.12, k),
        0,
        0.07,
        PHOTON_COLOR,
      );
    }
    if (split < 1)
      paint.molecule("O2", 0, y, 0, 0.3 * Math.sin(time + lane), size);
    for (const side of [-1, 1]) {
      if (split >= 1 && joined < 1) {
        paint.molecule("O", side * mix(0.1, 1.45, travel), y, 0, 0, size);
      }
      if (joined < 1) {
        paint.molecule(
          "O2",
          side * 1.7,
          y,
          0,
          0.4 * Math.sin(time * 0.7 + lane + side),
          size,
        );
      } else {
        paint.molecule(
          "O3",
          side * mix(1.7, 1.9, stage(u, 0.6, 1)),
          y,
          0,
          0.3 * Math.sin(time + side),
          size,
        );
      }
      const away = stage(u, 0.58, 0.9);
      paint.molecule(
        "N2",
        side * mix(2.15, 2.9, away),
        y - mix(0.4, 0.8, away),
        0,
        time * (0.4 + away * 2),
        size,
      );
    }
  }
}

export const WATER_SURFACE_Y = -1.3;

function liquidWater(time: number, paint: Painter) {
  for (let index = 0; index < 26; index += 1) {
    const x = mix(-3, 3, noise(index, 1)) + 0.05 * Math.sin(time * 3 + index);
    const y =
      mix(-2.15, WATER_SURFACE_Y - 0.12, noise(index, 2)) +
      0.04 * Math.cos(time * 3.4 + index * 2);
    paint.molecule(
      "H2O",
      x,
      y,
      0,
      noise(index, 3) * 6.28 + 0.4 * Math.sin(time * 2 + index),
    );
  }
}

function waterEvaporation({ time, value }: ScriptInput, paint: Painter) {
  liquidWater(time, paint);
  const leaving = amountFor(value, 2, 18);
  for (let index = 0; index < leaving; index += 1) {
    const u = fract(time / 7 + noise(index, 4));
    const x = mix(-2.8, 2.8, noise(index, 5)) + 0.25 * Math.sin(u * 9 + index);
    paint.molecule(
      "H2O",
      x,
      mix(WATER_SURFACE_Y, 2.4, u),
      0,
      time * 1.5 + index,
      appear(u),
    );
  }
}

function freeVapor(time: number, count: number, paint: Painter) {
  for (let index = 0; index < count; index += 1) {
    const angle = noise(index, 6) * 6.28;
    const speed = 0.35 + 0.3 * noise(index, 7);
    const x = bounce(
      mix(-3, 3, noise(index, 8)) + Math.cos(angle) * speed * time,
      3,
    );
    const y =
      bounce(
        mix(-1.5, 1.5, noise(index, 9)) + Math.sin(angle) * speed * time,
        1.5,
      ) + 0.55;
    paint.molecule("H2O", x, y, 0, time * (1 + noise(index, 10)) + index);
  }
}

function waterVapor({ time, value }: ScriptInput, paint: Painter) {
  freeVapor(time, amountFor(value, 4, 40), paint);
  // A cloud droplet (far larger in reality) where vapor has condensed.
  paint.blob(2.1, 1.5, -0.2, 0.62);
  for (let index = 0; index < 7; index += 1) {
    const angle = noise(index, 11) * 6.28;
    const radius = 0.42 * Math.sqrt(noise(index, 12));
    paint.molecule(
      "H2O",
      2.1 + radius * Math.cos(angle) + 0.03 * Math.sin(time * 3 + index),
      1.5 + radius * Math.sin(angle),
      0,
      noise(index, 13) * 6.28,
    );
  }
}

function waterPrecipitation({ time, value }: ScriptInput, paint: Painter) {
  liquidWater(time, paint);
  freeVapor(time, 5, paint);
  const drops = amountFor(value, 1, 6);
  for (let index = 0; index < drops; index += 1) {
    const u = fract(time / 4.5 + noise(index, 14));
    const x = mix(-2.6, 2.6, noise(index, 15));
    const y = mix(2.6, WATER_SURFACE_Y, u * u);
    const radius = 0.34 * appear(u);
    paint.blob(x, y, -0.2, radius);
    for (let inner = 0; inner < 4; inner += 1) {
      const angle = noise(index * 7 + inner, 16) * 6.28 + time;
      paint.molecule(
        "H2O",
        x + 0.17 * Math.cos(angle),
        y + 0.17 * Math.sin(angle),
        0,
        angle,
        appear(u),
      );
    }
  }
}

export const THERMAL_REFERENCE_K = 273.15;
const N2_MOLAR_MASS = 28.014;
const O2_MOLAR_MASS = 31.998;

// Speed of a molecule in this view relative to N2 at 0 °C: sqrt(T / M),
// the proportionality in v(rms) = sqrt(3RT / M).
export function relativeThermalSpeed(
  kelvin: number | null,
  molarMass: number,
): number {
  if (kelvin === null || !(kelvin > 0)) return 0;
  return Math.sqrt(
    (kelvin / THERMAL_REFERENCE_K) * (N2_MOLAR_MASS / molarMass),
  );
}

// 20 N2 and 6 O2: close to dry air's 78 % and 21 % by volume.
function thermalAir({ time, kelvin }: ScriptInput, paint: Painter) {
  for (let index = 0; index < 26; index += 1) {
    const oxygen = index % 13 === 4 || index % 13 === 9 || index % 13 === 12;
    const speed =
      1.1 *
      relativeThermalSpeed(kelvin, oxygen ? O2_MOLAR_MASS : N2_MOLAR_MASS);
    const angle = noise(index, 17) * 6.28;
    const x = bounce(
      mix(-3, 3, noise(index, 18)) + Math.cos(angle) * speed * time,
      3,
    );
    const y = bounce(
      mix(-2, 2, noise(index, 19)) + Math.sin(angle) * speed * time,
      2,
    );
    paint.molecule(
      oxygen ? "O2" : "N2",
      x,
      y,
      0,
      noise(index, 20) * 6.28 + speed * time * 0.8,
    );
  }
}

// Gas molecules next to the edge of one aerosol particle 100 nm across,
// drawn at the same scale (the particle itself is a static mesh).
function aerosolScale({ time }: ScriptInput, paint: Painter) {
  for (let index = 0; index < 16; index += 1) {
    const angle = noise(index, 21) * 6.28;
    const speed = 0.5 + 0.4 * noise(index, 22);
    const x = bounce(
      mix(-3, 3, noise(index, 23)) + Math.cos(angle) * speed * time,
      3,
    );
    const y =
      bounce(
        mix(-1.2, 1.2, noise(index, 24)) + Math.sin(angle) * speed * time,
        1.5,
      ) + 0.9;
    paint.molecule(index % 5 === 0 ? "O2" : "N2", x, y, 0, time + index);
  }
}

// Overall exchange only: CO2 and H2O go in, O2 comes out, light arrives.
function photosynthesis({ time, value }: ScriptInput, paint: Painter) {
  const sets = amountFor(value, 1, 5);
  for (let index = 0; index < sets; index += 1) {
    const u = fract(time / 8 + noise(index, 25));
    const y = mix(-1.2, 1.2, noise(index, 26));
    const inward = stage(u, 0, 0.45);
    if (u < 0.45) {
      paint.molecule(
        "CO2",
        mix(-3.2, -1.0, inward),
        y + 0.25,
        0,
        time * 0.5 + index,
        appear(u / 0.45),
      );
      paint.molecule(
        "H2O",
        mix(-3.2, -1.0, inward),
        y - 0.3,
        0,
        time * 0.8 + index,
        appear(u / 0.45),
      );
      paint.solid(
        mix(-0.8, 0, inward) + index * 0.25 - 0.5,
        mix(2.6, 0.75, inward),
        0,
        0.07,
        PHOTON_COLOR,
      );
    } else {
      const outward = stage(u, 0.5, 1);
      paint.molecule(
        "O2",
        mix(1.0, 3.2, outward),
        y,
        0,
        time * 0.7 + index,
        appear(outward),
      );
    }
  }
}

export const SOIL_PORES = 10;

// Grains on a fixed grid with a little disorder; water fills the gaps.
function soilPores({ time, value }: ScriptInput, paint: Painter) {
  for (let index = 0; index < 15; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    paint.solid(
      (column - 2) * 1.25 +
        (row % 2) * 0.6 -
        0.3 +
        0.12 * (noise(index, 27) - 0.5),
      (row - 1) * 1.15 + 0.12 * (noise(index, 28) - 0.5),
      0,
      0.5 + 0.1 * noise(index, 29),
      GRAIN_COLOR,
    );
  }
  const filled = amountFor(value, 0, SOIL_PORES);
  for (let index = 0; index < filled; index += 1) {
    const column = index % 5;
    const row = Math.floor(index / 5);
    paint.blob(
      (column - 2) * 1.25 + 0.3 + (row % 2) * 0.6 - 0.3,
      (row - 0.5) * 1.15 + 0.02 * Math.sin(time * 2 + index),
      0.25,
      0.3,
    );
  }
}

export type Script = (input: ScriptInput, paint: Painter) => void;

export const scripts: Record<CloseUpId, Script> = {
  "water-evaporation": waterEvaporation,
  "water-vapor": waterVapor,
  "water-precipitation": waterPrecipitation,
  "no2-photolysis": no2Photolysis,
  "ozone-chapman": ozoneChapman,
  "thermal-air": thermalAir,
  "thermal-surface": thermalAir,
  "aerosol-scale": aerosolScale,
  photosynthesis,
  "soil-pores": soilPores,
};

// Static backdrop each scene kind needs besides what its script paints.
export const backdropFor: Record<
  SceneKind,
  "none" | "water" | "aerosol" | "leaf"
> = {
  water: "water",
  reaction: "none",
  thermal: "none",
  aerosol: "aerosol",
  photosynthesis: "leaf",
  soil: "none",
};
