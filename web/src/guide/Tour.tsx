// The guided tour: one companion at a time says one short step, the visitor
// presses Next (or clicks the bubble, or Enter / →), and can skip at any
// moment. The steps are data (tourScript.ts); the sentences are template
// lines filled with numbers (companions/companionLine.ts). Nothing is
// interpreted here.
import { useEffect, useRef, useState } from "react";
import { Companion } from "../companions/Companion";
import {
  spokenLine,
  type CompanionSentences,
} from "../companions/companionLine";
import { companionFor, companionTitle } from "../companions/companionSpec";
import { speak, speechAvailable, stopSpeaking } from "../companions/speech";
import type { TrendSignal } from "../forms/encoding";
import {
  getMessageLocale,
  monthYear,
  useI18n,
  type Locale,
  type Vars,
} from "../i18n";
import { stratumHeight, stratumName } from "../strata/strataSpec";
import "./guide.css";
import { TOUR_STEPS } from "./tourScript";

export type TourFigure = {
  // Normalized value 0..1, null without data.
  value: number | null;
  anomalyZ: number | null;
  signal?: TrendSignal;
};

type TourProps = {
  // Index into TOUR_STEPS.
  step: number;
  // Values for the placeholders of the fixed lines ({{place}}, {{month}}).
  vars: Vars;
  month?: string | null;
  // The template sentences of a companion at the current place and month.
  sentences: (
    variableId: string,
    formatLocale?: Locale,
  ) => CompanionSentences | null;
  figure: (variableId: string) => TourFigure;
  onStep: (index: number) => void;
  // Skip, Esc, or Next on the last step.
  onEnd: () => void;
};

export function Tour({
  step,
  vars,
  month,
  sentences,
  figure,
  onStep,
  onEnd,
}: TourProps) {
  const { t, voice } = useI18n();
  const [voiceOn, setVoiceOn] = useState(false);
  const nextButton = useRef<HTMLButtonElement>(null);
  const current = TOUR_STEPS[step];
  const last = step >= TOUR_STEPS.length - 1;
  const next = () => (last ? onEnd() : onStep(step + 1));
  const back = () => {
    if (step > 0) onStep(step - 1);
  };

  const said = current ? sentences(current.speaker) : null;
  const lines = current
    ? [
        ...current.messages.map((key) => t(key, vars)),
        ...current.lines
          .map((line) => said?.[line] ?? null)
          .filter((line): line is string => !!line),
      ]
    : [];
  const speechLocale = getMessageLocale(
    current?.messages[0] ??
      (voice === "expert"
        ? "companions.line.noMonth"
        : "companions.say.noMonth"),
  );
  const spokenMonth = month
    ? monthYear(month, "long", speechLocale)
    : vars.month;
  const spokenSentences = current
    ? sentences(current.speaker, speechLocale)
    : null;
  const spokenText = current
    ? [
        ...current.messages.map((key) =>
          t(key, { ...vars, month: spokenMonth }),
        ),
        ...current.lines
          .map((line) => spokenSentences?.[line] ?? null)
          .filter((line): line is string => !!line),
      ].join(" ")
    : "";

  // Keys work wherever the focus is; the capture phase keeps the arrows from
  // also stepping the timeline.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
      ) {
        return;
      }
      if (event.key === "Escape") onEnd();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
      else if (event.key === "Enter" && !(target instanceof HTMLButtonElement))
        next();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => {
    nextButton.current?.focus({ preventScroll: true });
  }, [step]);
  useEffect(() => {
    if (voiceOn && spokenText) speak(spokenLine(spokenText), speechLocale);
  }, [voiceOn, spokenText, speechLocale]);
  useEffect(() => stopSpeaking, []);

  if (!current) return null;
  const spec = companionFor(current.speaker);
  const shape = figure(current.speaker);
  const height = current.stratum ? stratumHeight(current.stratum) : null;

  return (
    <section
      className="guide-tour"
      role="dialog"
      aria-label={t("guide.tour.aria")}
    >
      <div className="guide-tour-figure" aria-hidden="true">
        <Companion
          variableId={current.speaker}
          value={shape.value}
          anomalyZ={shape.anomalyZ}
          signal={shape.signal}
          size={76}
          showLabel={false}
        />
      </div>
      <div className="guide-tour-bubble">
        <p className="guide-tour-head">
          <strong>{spec ? companionTitle(spec) : ""}</strong>
          {current.stratum ? (
            <span>
              {stratumName(current.stratum)}
              {height ? ` · ${height}` : ""}
            </span>
          ) : null}
          <span className="guide-tour-progress">
            {t("guide.tour.progress", {
              current: step + 1,
              total: TOUR_STEPS.length,
            })}
          </span>
        </p>
        <div aria-live="polite">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <footer>
          <button type="button" className="guide-tour-skip" onClick={onEnd}>
            {t("common.action.skip")}
          </button>
          {speechAvailable() ? (
            <button
              type="button"
              aria-pressed={voiceOn}
              onClick={() => {
                if (voiceOn) stopSpeaking();
                setVoiceOn(!voiceOn);
              }}
            >
              {t(voiceOn ? "companions.voiceOn" : "companions.voiceOff")}
            </button>
          ) : null}
          <button type="button" onClick={back} disabled={step === 0}>
            {t("common.action.back")}
          </button>
          <button
            type="button"
            className="guide-start"
            ref={nextButton}
            onClick={next}
          >
            {t(last ? "guide.tour.finish" : "common.action.next")}
          </button>
        </footer>
        <p className="guide-tour-keys">{t("guide.tour.keys")}</p>
      </div>
    </section>
  );
}
