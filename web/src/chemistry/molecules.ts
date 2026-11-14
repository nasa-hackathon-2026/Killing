// Structural data for the molecules drawn in the close-up views and used as
// particle shapes on the globe. Every value has a `source`. Do not add a
// number here without one; draw the thing as a schematic instead.

const CCCBDB = "NIST CCCBDB Release 22 (May 2022), experimental geometry";

export type ElementId = "H" | "C" | "N" | "O";

export type ElementData = {
  symbol: ElementId;
  // Bondi van der Waals radius in angstrom.
  vdwRadius: number;
  // Conventional CPK display color.
  cpkColor: string;
  source: string;
};

const BONDI =
  "A. Bondi (1964), van der Waals Volumes and Radii, J. Phys. Chem. 68, 441; colors follow the CPK convention (H white, C dark grey, N blue, O red)";

export const elements: Record<ElementId, ElementData> = {
  H: { symbol: "H", vdwRadius: 1.2, cpkColor: "#f2f2f2", source: BONDI },
  C: { symbol: "C", vdwRadius: 1.7, cpkColor: "#4a4a4a", source: BONDI },
  N: { symbol: "N", vdwRadius: 1.55, cpkColor: "#3050f8", source: BONDI },
  O: { symbol: "O", vdwRadius: 1.52, cpkColor: "#ff2a2a", source: BONDI },
};

export type MoleculeId =
  "H2O" | "NO2" | "O3" | "N2" | "O2" | "CO2" | "NO" | "O";

export type MoleculeData = {
  id: MoleculeId;
  formula: string;
  nameEn: string;
  // Central atom first for triatomics: [center, end, end].
  atoms: ElementId[];
  // Bond length in angstrom (center to each end; the one bond of a diatomic).
  bondLength: number | null;
  // Angle end-center-end in degrees; null for atoms and diatomics.
  bondAngle: number | null;
  // Molar mass in g/mol, from standard atomic weights.
  molarMass: number;
  source: string;
  sourceUrl: string | null;
};

function cccbdb(casno: string): string {
  return `https://cccbdb.nist.gov/exp2x.asp?casno=${casno}`;
}

export const molecules: Record<MoleculeId, MoleculeData> = {
  H2O: {
    id: "H2O",
    formula: "H₂O",
    nameEn: "Water",
    atoms: ["O", "H", "H"],
    bondLength: 0.958,
    bondAngle: 104.48,
    molarMass: 18.015,
    source: `${CCCBDB}: rOH 0.958 Å, aHOH 104.4776° (Hoy & Bunker 1979)`,
    sourceUrl: cccbdb("7732185"),
  },
  NO2: {
    id: "NO2",
    formula: "NO₂",
    nameEn: "Nitrogen dioxide",
    atoms: ["N", "O", "O"],
    bondLength: 1.193,
    bondAngle: 134.1,
    molarMass: 46.006,
    source: `${CCCBDB}: rNO 1.193 Å, aONO 134.1° (Herzberg 1966)`,
    sourceUrl: cccbdb("10102440"),
  },
  O3: {
    id: "O3",
    formula: "O₃",
    nameEn: "Ozone",
    atoms: ["O", "O", "O"],
    bondLength: 1.278,
    bondAngle: 116.8,
    molarMass: 47.997,
    source: `${CCCBDB}: rOO 1.278 Å, aOOO 116.8° (Herzberg 1966)`,
    sourceUrl: cccbdb("10028156"),
  },
  N2: {
    id: "N2",
    formula: "N₂",
    nameEn: "Nitrogen",
    atoms: ["N", "N"],
    bondLength: 1.098,
    bondAngle: null,
    molarMass: 28.014,
    source: `${CCCBDB}: rNN 1.098 Å (Huber & Herzberg 1979)`,
    sourceUrl: cccbdb("7727379"),
  },
  O2: {
    id: "O2",
    formula: "O₂",
    nameEn: "Oxygen",
    atoms: ["O", "O"],
    bondLength: 1.208,
    bondAngle: null,
    molarMass: 31.998,
    source: `${CCCBDB}: rOO 1.208 Å (Huber & Herzberg 1979)`,
    sourceUrl: cccbdb("7782447"),
  },
  CO2: {
    id: "CO2",
    formula: "CO₂",
    nameEn: "Carbon dioxide",
    atoms: ["C", "O", "O"],
    bondLength: 1.162,
    bondAngle: 180,
    molarMass: 44.009,
    source: `${CCCBDB}: rCO 1.162 Å, linear (Herzberg 1966)`,
    sourceUrl: cccbdb("124389"),
  },
  NO: {
    id: "NO",
    formula: "NO",
    nameEn: "Nitric oxide",
    atoms: ["N", "O"],
    bondLength: 1.154,
    bondAngle: null,
    molarMass: 30.006,
    source: `${CCCBDB}: rNO 1.154 Å (r0, NIST diatomic database)`,
    sourceUrl: cccbdb("10102439"),
  },
  O: {
    id: "O",
    formula: "O",
    nameEn: "Oxygen atom",
    atoms: ["O"],
    bondLength: null,
    bondAngle: null,
    molarMass: 15.999,
    source: "Single atom; no geometry",
    sourceUrl: null,
  },
};

export type AtomPosition = { element: ElementId; x: number; y: number };

// Atom centers in angstrom in the molecular plane, centered on the mean of
// the atom positions. Triatomics open towards +y.
export function atomPositions(id: MoleculeId): AtomPosition[] {
  const molecule = molecules[id];
  const [first, second, third] = molecule.atoms;
  let raw: AtomPosition[];
  if (!first) return [];
  if (!second || molecule.bondLength === null) {
    raw = [{ element: first, x: 0, y: 0 }];
  } else if (!third || molecule.bondAngle === null) {
    raw = [
      { element: first, x: -molecule.bondLength / 2, y: 0 },
      { element: second, x: molecule.bondLength / 2, y: 0 },
    ];
  } else {
    const half = (molecule.bondAngle * Math.PI) / 360;
    const dx = molecule.bondLength * Math.sin(half);
    const dy = molecule.bondLength * Math.cos(half);
    raw = [
      { element: first, x: 0, y: 0 },
      { element: second, x: -dx, y: dy },
      { element: third, x: dx, y: dy },
    ];
  }
  const cx = raw.reduce((sum, atom) => sum + atom.x, 0) / raw.length;
  const cy = raw.reduce((sum, atom) => sum + atom.y, 0) / raw.length;
  return raw.map((atom) => ({
    element: atom.element,
    x: atom.x - cx,
    y: atom.y - cy,
  }));
}

// Molar gas constant, J/(mol K). Exact in the 2019 SI.
export const GAS_CONSTANT = 8.314462618;

// Root-mean-square speed of an ideal-gas molecule in m/s: sqrt(3RT/M).
// Kinetic theory of gases; any general physics or physical chemistry text.
export function rmsSpeed(
  kelvin: number,
  molarMassGramsPerMole: number,
): number {
  if (!(kelvin > 0) || !(molarMassGramsPerMole > 0)) return 0;
  return Math.sqrt(
    (3 * GAS_CONSTANT * kelvin) / (molarMassGramsPerMole / 1000),
  );
}
