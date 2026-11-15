import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState, type RefObject } from "react";
import { CloseUpPanel } from "../closeup/CloseUpPanel";
import { closeUp } from "../closeup/closeUps";
import { formColor } from "../forms/formColor";
import {
  encodeForm,
  trendMark,
  trendArrowDirection,
  type TrendSignal,
} from "../forms/encoding";
import { formMapping, formSpec } from "../forms/formMapping";
import { motionScale } from "../forms/reducedMotion";
import { formRegistry, type FormDefinition } from "../forms/registry";
import { TrendArrows } from "../forms/TrendArrows";
import { mockVariables } from "../mock/snapshot";
import { createSceneRenderer } from "../scene/createSceneRenderer";
import { carryChoices, localNumber, useI18n } from "../i18n";
import { LanguageMenu, ModeSwitch } from "../i18n/ChoiceControls";
import { variableName } from "../i18n/names";
import { FpsReadout } from "../scene/FpsReadout";
import "./lab.css";
import { rendererLabel, type RendererKind } from "../scene/rendererLabel";

// `label` is the message key under lab.trend.
const trendChoices: { label: string; signal: TrendSignal }[] = [
  { label: "notSignificant", signal: { state: "not-significant", fdr: false } },
  { label: "rising", signal: { state: "rising", fdr: true } },
  { label: "falling", signal: { state: "falling", fdr: true } },
  { label: "insufficient", signal: { state: "insufficient", fdr: false } },
];

function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function Clock({
  playing,
  timeRef,
}: {
  playing: boolean;
  timeRef: RefObject<number>;
}) {
  useFrame((_, delta) => {
    if (playing) timeRef.current += delta * motionScale();
  });
  return null;
}

function Stage({
  form,
  variableId,
  value,
  playing,
  trendDirection,
}: {
  form: FormDefinition;
  variableId: string;
  value: number;
  playing: boolean;
  trendDirection: number;
}) {
  const time = useRef(0);
  const opacity = useRef(1);
  const variable = mockVariables.find((item) => item.id === variableId);
  const FormParticles = form.Component;

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 2, 4]} intensity={1.1} />
      <Clock playing={playing} timeRef={time} />
      <FormParticles
        key={variableId}
        value={value}
        timeRef={time}
        opacityRef={opacity}
        color={variable ? formColor(variable) : "#ffffff"}
        variableId={variableId}
      />
      {trendDirection !== 0 ? (
        <TrendArrows
          direction={trendDirection}
          radius={1.42}
          color={variable?.glassColor ?? "#ffffff"}
          timeRef={time}
          opacityRef={opacity}
        />
      ) : null}
    </>
  );
}

export function FormLab() {
  const { t, locale } = useI18n();
  const [variableId, setVariableId] = useState(() => {
    const asked = readParam("variable");
    return formSpec(asked ?? "") ? (asked as string) : "imerg_precip";
  });
  const [value, setValue] = useState(() => {
    const asked = Number(readParam("value") ?? "1");
    return Number.isFinite(asked) ? Math.min(1, Math.max(0, asked)) : 1;
  });
  const [playing, setPlaying] = useState(true);
  const [trendIndex, setTrendIndex] = useState(() => {
    const asked = Number(readParam("trend") ?? "0");
    return trendChoices[asked] ? asked : 0;
  });
  const [kind, setKind] = useState<RendererKind>("webgl");
  const [closeUpOpen, setCloseUpOpen] = useState(
    () => readParam("closeup") !== null,
  );
  const spec = formSpec(variableId);
  const form =
    formRegistry.find((item) => item.id === spec?.formId) ?? formRegistry[0];
  const signal = trendChoices[trendIndex]?.signal;
  const encoding = spec ? encodeForm(value, spec.encoding) : null;
  const variable = mockVariables.find((item) => item.id === variableId);
  const thermal = spec ? closeUp(spec.closeUpId)?.scene === "thermal" : false;
  // Lab only: the slider stands for -10 °C to 40 °C in the thermal views.
  const labKelvin = thermal ? 263.15 + value * 50 : null;

  return (
    <div className="app">
      {form ? (
        <Canvas
          camera={{ position: [0, 0, 3.2], fov: 45 }}
          dpr={[1, 2]}
          gl={createSceneRenderer(false, setKind)}
        >
          <Stage
            form={form}
            variableId={variableId}
            value={value}
            playing={playing}
            trendDirection={trendArrowDirection(signal)}
          />
        </Canvas>
      ) : null}
      <h1 className="lab-title">
        {t("lab.title")} <span>{t("lab.intro")}</span>
      </h1>
      <div className="hud">
        <p className="badge">
          {t("lab.renderer", { name: rendererLabel(kind) })}
        </p>
        <FpsReadout />
        <a href={carryChoices(import.meta.env.BASE_URL)}>{t("lab.back")}</a>
        <LanguageMenu />
        <ModeSwitch />
        <label>
          {t("lab.control.variable")}
          <select
            value={variableId}
            onChange={(event) => setVariableId(event.target.value)}
          >
            {formMapping.map((row) => {
              const variable = mockVariables.find(
                (item) => item.id === row.variableId,
              );
              const rowForm = formRegistry.find(
                (item) => item.id === row.formId,
              );
              return (
                <option key={row.variableId} value={row.variableId}>
                  {variableName(
                    row.variableId,
                    variable?.nameEn ?? row.variableId,
                  )}{" "}
                  — {rowForm?.nameEn}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          {t("lab.control.value")}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={value}
            aria-label={t("lab.control.valueAria")}
            onChange={(event) => setValue(Number(event.target.value))}
          />
        </label>
        <p className="badge">{localNumber(value.toFixed(2))}</p>
        <label>
          {t("lab.control.trend")}
          <select
            value={trendIndex}
            onChange={(event) => setTrendIndex(Number(event.target.value))}
          >
            {trendChoices.map((choice, index) => (
              <option key={choice.label} value={index}>
                {t(`lab.trend.${choice.label}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setPlaying((current) => !current)}>
          {playing ? t("lab.control.pause") : t("lab.control.play")}
        </button>
        <button type="button" onClick={() => setCloseUpOpen((open) => !open)}>
          {closeUpOpen
            ? t("lab.control.hideCloseUp")
            : t("lab.control.closeUp")}
        </button>
      </div>
      {closeUpOpen ? (
        <CloseUpPanel
          variableId={variableId}
          variableName={t("lab.labSuffix", {
            name: variableName(variableId, variable?.nameEn ?? variableId),
          })}
          value={value}
          reading={
            labKelvin !== null
              ? t("lab.labValue", {
                  value: `${localNumber((labKelvin - 273.15).toFixed(1))} °C`,
                })
              : t("lab.labValue", { value: localNumber(value.toFixed(2)) })
          }
          kelvin={labKelvin}
          trendLabel={
            signal ? trendMark(signal).label.toLowerCase() : undefined
          }
          onClose={() => setCloseUpOpen(false)}
        />
      ) : null}
      {spec && encoding ? (
        <p className="lab-note">
          {form?.nameEn} · motion: {spec.motion} · {encoding.count} of{" "}
          {spec.encoding.maxCount} particles · size ×{encoding.size.toFixed(2)}{" "}
          · speed ×{encoding.speed.toFixed(2)}
          {spec.engine === "legacy"
            ? " (original form; its own numbers apply)"
            : ""}
          <br />
          {spec.note} {t("lab.footer")}
          {locale === "en" ? null : (
            <>
              <br />
              {t("common.partial")}
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}
