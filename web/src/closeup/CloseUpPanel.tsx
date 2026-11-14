import { Canvas } from "@react-three/fiber";
import { elements, molecules, rmsSpeed } from "../chemistry/molecules";
import { formSpec } from "../forms/formMapping";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { closeUp, SCHEMATIC_NOTE, type SceneKind } from "./closeUps";
import { CloseUpScene } from "./CloseUpScene";
import { ATOM_RADIUS_FRACTION, PHOTON_COLOR } from "./scripts";

// How far back the camera sits for each kind of scene (scene units).
const CAMERA_DISTANCE: Record<SceneKind, number> = {
  water: 7.2,
  reaction: 4.4,
  thermal: 6.4,
  aerosol: 6.4,
  photosynthesis: 6.4,
  soil: 6,
};

type CloseUpPanelProps = {
  variableId: string;
  variableName: string;
  // Normalized reading, 0..1 (0 when the month has no data).
  value: number;
  // The reading as shown in the layer panel, e.g. "28.0 °C" or "No data".
  reading: string;
  // Absolute temperature when the variable is one, else null.
  kelvin: number | null;
  trendLabel?: string;
  onClose: () => void;
};

// The close-up view of one layer. It owns its canvas, so nothing here is
// loaded or drawn until a view is opened, and all of it is released on close.
export function CloseUpPanel({
  variableId,
  variableName,
  value,
  reading,
  kelvin,
  trendLabel,
  onClose,
}: CloseUpPanelProps) {
  const spec = formSpec(variableId);
  const view = spec ? closeUp(spec.closeUpId) : undefined;
  if (!view) return null;
  const thermal = view.scene === "thermal";
  const shown = view.molecules.map((id) => molecules[id]);
  const usedElements = [
    ...new Set(shown.flatMap((molecule) => molecule.atoms)),
  ].map((id) => elements[id]);

  return (
    <section className="closeup" aria-label={`Close-up: ${view.titleEn}`}>
      <header>
        <div>
          <p className="closeup-kicker">
            {variableName} · {reading}
            {trendLabel ? ` · trend: ${trendLabel}` : ""}
          </p>
          <h2>{view.titleEn}</h2>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="closeup-canvas">
        <Canvas
          key={view.id}
          camera={{ position: [0, 0, CAMERA_DISTANCE[view.scene]], fov: 40 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "low-power" }}
        >
          <CloseUpScene id={view.id} value={value} kelvin={kelvin} />
        </Canvas>
        <p className="closeup-tag">
          {view.scene === "aerosol"
            ? "Molecules and the particle edge share one scale; atoms drawn smaller."
            : SCHEMATIC_NOTE}
          {prefersReducedMotion() ? " Motion is off (system setting)." : ""}
        </p>
      </div>
      <div className="closeup-text">
        {view.equations.map((equation) => (
          <p key={equation} className="closeup-equation">
            {equation}
          </p>
        ))}
        <p>{view.textEn}</p>
        <p>
          {view.scene === "aerosol"
            ? "The grey surface is the edge of a single particle 100 nm across; this view does not change with the value."
            : view.valueEn}
          {reading === "No data" ? " This month has no data." : ""}
        </p>
        {thermal && kelvin !== null ? (
          <p>
            At {(kelvin - 273.15).toFixed(1)} °C ({kelvin.toFixed(1)} K): N₂
            about {Math.round(rmsSpeed(kelvin, molecules.N2.molarMass))} m/s, O₂
            about {Math.round(rmsSpeed(kelvin, molecules.O2.molarMass))} m/s
            (root-mean-square speed).
          </p>
        ) : null}
        {usedElements.length > 0 ? (
          <p className="closeup-legend">
            {usedElements.map((element) => (
              <span key={element.symbol}>
                <i style={{ background: element.cpkColor }} />
                {element.symbol}
              </span>
            ))}
            {view.scene === "reaction" || view.scene === "photosynthesis" ? (
              <span>
                <i style={{ background: PHOTON_COLOR }} />
                light (hν), drawn as a ball
              </span>
            ) : null}
            <span>
              CPK colors; spheres at {Math.round(ATOM_RADIUS_FRACTION * 100)}%
              of van der Waals radius
            </span>
          </p>
        ) : null}
        {shown.some((molecule) => molecule.bondLength !== null) ? (
          <table>
            <thead>
              <tr>
                <th>Molecule</th>
                <th>Bond length</th>
                <th>Bond angle</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {shown
                .filter((molecule) => molecule.bondLength !== null)
                .map((molecule) => (
                  <tr key={molecule.id}>
                    <td>
                      {molecule.formula} {molecule.nameEn}
                    </td>
                    <td>{molecule.bondLength?.toFixed(3)} Å</td>
                    <td>
                      {molecule.bondAngle === null
                        ? "—"
                        : `${molecule.bondAngle.toFixed(1)}°`}
                    </td>
                    <td>
                      {molecule.sourceUrl ? (
                        <a
                          href={molecule.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          NIST CCCBDB
                        </a>
                      ) : (
                        molecule.source
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : null}
        <p className="closeup-sources">
          Sources: {view.sources.join("; ")}. Atom radii:{" "}
          {elements.O.source.split(";")[0]}.
        </p>
      </div>
    </section>
  );
}
