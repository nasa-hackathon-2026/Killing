import { Canvas } from "@react-three/fiber";
import { useRef } from "react";
import { elements, molecules, rmsSpeed } from "../chemistry/molecules";
import { formSpec } from "../forms/formMapping";
import { localNumber, useI18n } from "../i18n";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { closeUp, type SceneKind } from "./closeUps";
import { CloseUpScene } from "./CloseUpScene";
import { MAX_CLOSEUP_LABELS } from "./labels";
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
  // False when the month has no value.
  hasData?: boolean;
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
  hasData = true,
  kelvin,
  trendLabel,
  onClose,
}: CloseUpPanelProps) {
  const { t, tm, settings } = useI18n();
  const labelLayer = useRef<HTMLDivElement>(null);
  const spec = formSpec(variableId);
  const view = spec ? closeUp(spec.closeUpId) : undefined;
  if (!view) return null;
  const thermal = view.scene === "thermal";
  const base = `closeup.views.${view.id}`;
  const shown = view.molecules.map((id) => molecules[id]);
  const usedElements = [
    ...new Set(shown.flatMap((molecule) => molecule.atoms)),
  ].map((id) => elements[id]);

  // Numbers, the molecule table and the sources: shown as they are for a
  // researcher, folded under "Details" otherwise.
  const extra = (
    <>
      {thermal && kelvin !== null ? (
        <p>
          {t("closeup.thermal", {
            celsius: localNumber((kelvin - 273.15).toFixed(1)),
            kelvin: localNumber(kelvin.toFixed(1)),
            n2: Math.round(rmsSpeed(kelvin, molecules.N2.molarMass)),
            o2: Math.round(rmsSpeed(kelvin, molecules.O2.molarMass)),
          })}
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
              {t("closeup.light")}
            </span>
          ) : null}
          <span>
            {t("closeup.cpk", {
              percent: Math.round(ATOM_RADIUS_FRACTION * 100),
            })}
          </span>
        </p>
      ) : null}
      {shown.some((molecule) => molecule.bondLength !== null) ? (
        <table>
          <thead>
            <tr>
              <th>{t("closeup.table.molecule")}</th>
              <th>{t("closeup.table.bondLength")}</th>
              <th>{t("closeup.table.bondAngle")}</th>
              <th>{t("closeup.table.source")}</th>
            </tr>
          </thead>
          <tbody>
            {shown
              .filter((molecule) => molecule.bondLength !== null)
              .map((molecule) => (
                <tr key={molecule.id}>
                  <td>
                    {molecule.formula} {t(`closeup.molecules.${molecule.id}`)}
                  </td>
                  <td>
                    {localNumber(molecule.bondLength?.toFixed(3) ?? "")} Å
                  </td>
                  <td>
                    {molecule.bondAngle === null
                      ? "—"
                      : `${localNumber(molecule.bondAngle.toFixed(1))}°`}
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
        {t("closeup.sources", {
          sources: view.sources.join("; "),
          radii: elements.O.source.split(";")[0] ?? "",
        })}
      </p>
    </>
  );

  return (
    <section
      className="closeup"
      aria-label={t("closeup.aria", { title: t(`${base}.title`) })}
    >
      <header>
        <div>
          <p className="closeup-kicker">
            {variableName} · {reading}
            {trendLabel
              ? ` · ${t("closeup.trend", { label: trendLabel })}`
              : ""}
          </p>
          <h2>{t(`${base}.title`)}</h2>
        </div>
        <button type="button" onClick={onClose}>
          {t("common.action.close")}
        </button>
      </header>
      <div className="closeup-canvas">
        <Canvas
          key={view.id}
          camera={{ position: [0, 0, CAMERA_DISTANCE[view.scene]], fov: 40 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, powerPreference: "low-power" }}
        >
          <CloseUpScene
            id={view.id}
            value={value}
            kelvin={kelvin}
            labelLayer={labelLayer}
          />
        </Canvas>
        <div className="closeup-labels" ref={labelLayer} aria-hidden="true">
          {Array.from({ length: MAX_CLOSEUP_LABELS }, (_, index) => (
            <span key={index} hidden />
          ))}
        </div>
        <p className="closeup-tag">
          {t(
            view.scene === "aerosol"
              ? "closeup.aerosolScale"
              : "closeup.schematic",
          )}
          {prefersReducedMotion() ? ` ${t("closeup.motionOff")}` : ""}
        </p>
      </div>
      <div className="closeup-text">
        {view.equations.map((equation) => (
          <p key={equation} className="closeup-equation">
            {equation}
          </p>
        ))}
        <p>{tm(`${base}.text`)}</p>
        <p>
          {view.scene === "aerosol"
            ? t("closeup.aerosolValue")
            : t(`${base}.value`)}
          {hasData ? "" : ` ${t("closeup.noDataMonth")}`}
        </p>
        {settings.fullStatistics ? (
          extra
        ) : (
          <details className="trend-details">
            <summary>{t("common.action.details")}</summary>
            {extra}
          </details>
        )}
      </div>
    </section>
  );
}
