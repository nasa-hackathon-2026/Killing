// What each close-up view shows and says. Text and sources live here so the
// team can correct them without touching the drawing code. Only processes
// with a clear textbook basis belong here; everything is drawn as a
// schematic and labeled so.
import type { MoleculeId } from "../chemistry/molecules";

export type CloseUpId =
  | "water-evaporation"
  | "water-vapor"
  | "water-precipitation"
  | "no2-photolysis"
  | "ozone-chapman"
  | "thermal-air"
  | "thermal-surface"
  | "aerosol-scale"
  | "photosynthesis"
  | "soil-pores";

export type SceneKind =
  "water" | "reaction" | "thermal" | "aerosol" | "photosynthesis" | "soil";

export type CloseUpDefinition = {
  id: CloseUpId;
  titleEn: string;
  scene: SceneKind;
  // Molecules whose structure is listed under the view.
  molecules: MoleculeId[];
  // Reaction or relation, as written in textbooks.
  equations: string[];
  // One or two sentences.
  textEn: string;
  // What the value of the layer changes in this view.
  valueEn: string;
  sources: string[];
};

const JACOB =
  "D. J. Jacob (1999), Introduction to Atmospheric Chemistry, Princeton University Press";
const SEINFELD =
  "J. H. Seinfeld & S. N. Pandis (2016), Atmospheric Chemistry and Physics, 3rd ed., Wiley";
const WALLACE =
  "J. M. Wallace & P. V. Hobbs (2006), Atmospheric Science: An Introductory Survey, 2nd ed., Academic Press";

const WATER_SCALE =
  "A typical cloud droplet is about 10 µm in radius and a typical raindrop about 1 mm, so a raindrop holds roughly a million cloud droplets' worth of water.";

export const closeUps: CloseUpDefinition[] = [
  {
    id: "water-evaporation",
    titleEn: "Evaporation: water molecules leave the surface",
    scene: "water",
    molecules: ["H2O"],
    equations: ["H₂O (liquid) → H₂O (gas)"],
    textEn:
      "Molecules at a wet surface that move fast enough escape into the air as vapor. Evapotranspiration also includes water released by plants.",
    valueEn: "A larger flux shows more molecules leaving the liquid.",
    sources: [WALLACE],
  },
  {
    id: "water-vapor",
    titleEn: "Water vapor: single molecules in the air",
    scene: "water",
    molecules: ["H2O"],
    equations: ["H₂O (gas) ⇌ H₂O (liquid)"],
    textEn:
      "Water vapor is an invisible gas of separate H₂O molecules. Where air cools enough, vapor condenses onto small particles and forms cloud droplets.",
    valueEn: "A larger column amount shows more molecules in the air.",
    sources: [WALLACE],
  },
  {
    id: "water-precipitation",
    titleEn: "Precipitation: droplets grow and fall",
    scene: "water",
    molecules: ["H2O"],
    equations: ["H₂O (gas) → H₂O (liquid): cloud droplets → raindrops"],
    textEn: `Cloud droplets that grow large enough fall as rain. ${WATER_SCALE}`,
    valueEn: "A higher rate shows drops falling more often.",
    sources: [WALLACE],
  },
  {
    id: "no2-photolysis",
    titleEn: "NO₂ and sunlight make ozone near the ground",
    scene: "reaction",
    molecules: ["NO2", "NO", "O", "O2", "O3"],
    equations: ["NO₂ + hν → NO + O", "O + O₂ + M → O₃ + M"],
    textEn:
      "Sunlight at wavelengths shorter than roughly 400 nm splits NO₂. The freed oxygen atom joins an O₂ molecule to form ozone; M is any air molecule that carries away the extra energy.",
    valueEn: "A larger NO₂ column shows more NO₂ molecules taking part.",
    sources: [JACOB, SEINFELD],
  },
  {
    id: "ozone-chapman",
    titleEn: "How ozone forms in the stratosphere",
    scene: "reaction",
    molecules: ["O2", "O", "O3"],
    equations: ["O₂ + hν → O + O", "O + O₂ + M → O₃ + M"],
    textEn:
      "Ultraviolet light at wavelengths shorter than about 242 nm splits O₂. Each oxygen atom joins another O₂ to form ozone (first steps of the Chapman mechanism). Total ozone counts the whole column, most of it in the stratosphere.",
    valueEn: "A larger ozone column shows more ozone being formed.",
    sources: [
      JACOB,
      "S. Chapman (1930), A theory of upper-atmospheric ozone, Mem. R. Meteorol. Soc. 3, 103",
    ],
  },
  {
    id: "thermal-air",
    titleEn: "Temperature is how fast molecules move",
    scene: "thermal",
    molecules: ["N2", "O2"],
    equations: ["v(rms) = √(3RT / M)"],
    textEn:
      "Air temperature measures the average kinetic energy of its molecules, mostly N₂ and O₂. Their typical speed grows with the square root of the absolute temperature.",
    valueEn:
      "Molecule speed in this view follows √T for the selected month, so the change between months is real but small.",
    sources: [
      "Kinetic theory of gases, e.g. P. Atkins & J. de Paula, Physical Chemistry",
      WALLACE,
    ],
  },
  {
    id: "thermal-surface",
    titleEn: "Temperature is how fast particles move",
    scene: "thermal",
    molecules: ["N2", "O2"],
    equations: ["v(rms) = √(3RT / M)"],
    textEn:
      "Land surface temperature is the temperature of the ground itself, where atoms vibrate in place rather than fly freely. The view shows air molecules at that temperature to illustrate the same idea: hotter means faster random motion.",
    valueEn:
      "Molecule speed in this view follows √T for the selected month, so the change between months is real but small.",
    sources: [
      "Kinetic theory of gases, e.g. P. Atkins & J. de Paula, Physical Chemistry",
      WALLACE,
    ],
  },
  {
    id: "aerosol-scale",
    titleEn: "Aerosols are particles, not molecules",
    scene: "aerosol",
    molecules: [],
    equations: [],
    textEn:
      "Aerosols are solid or liquid particles such as dust, smoke and sea salt, from a few nanometers to tens of micrometers across: thousands of times larger than a gas molecule (about 0.3 nm). The UV aerosol index is a unitless measure that responds mainly to UV-absorbing aerosols such as dust and smoke.",
    valueEn: "A higher index shows more grains.",
    sources: [SEINFELD],
  },
  {
    id: "photosynthesis",
    titleEn: "Green leaves: photosynthesis",
    scene: "photosynthesis",
    molecules: ["CO2", "H2O", "O2"],
    equations: ["6 CO₂ + 6 H₂O + light → C₆H₁₂O₆ + 6 O₂"],
    textEn:
      "Chlorophyll in the chloroplasts of leaf cells absorbs light and uses it to build sugar from CO₂ and water, releasing O₂. NDVI measures how green the surface looks from space: (NIR − red) / (NIR + red).",
    valueEn: "A higher NDVI shows more molecules being exchanged.",
    sources: [
      "Overall equation of oxygenic photosynthesis, e.g. Campbell Biology; NDVI: C. J. Tucker (1979), Remote Sens. Environ. 8, 127",
    ],
  },
  {
    id: "soil-pores",
    titleEn: "Soil moisture: water between soil grains",
    scene: "soil",
    molecules: ["H2O"],
    equations: [],
    textEn:
      "Soil is grains with gaps (pores) between them. Soil moisture is the water held in those pores; here it is the water in the top 10 cm, in kilograms per square meter.",
    valueEn: "A wetter month shows more of the pore space filled with water.",
    sources: [
      "Soil water in pore space, e.g. D. Hillel (2004), Introduction to Environmental Soil Physics",
    ],
  },
];

export function closeUp(id: CloseUpId): CloseUpDefinition | undefined {
  return closeUps.find((item) => item.id === id);
}

export const SCHEMATIC_NOTE = "Schematic, not to scale.";
