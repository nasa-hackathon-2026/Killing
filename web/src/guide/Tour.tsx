// The guided tour: one companion at a time says one short step, the visitor
// presses Next (or Enter / →), can go back, jump to a chapter, or skip at
// any moment. The steps are data (tourScript.ts); the sentences are message
// keys or template lines filled with numbers (companions/companionLine.ts).
// The region a step talks about gets a ring, and the bubble is placed where
// it covers that region least. Nothing is interpreted here.
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
  hasMessage,
  monthYear,
  t,
  useI18n,
  type Locale,
  type Vars,
} from "../i18n";
import { variableName } from "../i18n/names";
import "./guide.css";
import { useParticleStyle } from "../forms/calm/particleStyle";
import { exampleHref, GUIDE_EXAMPLES } from "./examples";
import {
  chapterStart,
  TOUR_CHAPTERS,
  TOUR_NEXT,
  TOUR_STEPS,
  tourMessageKey,
  type TourTarget,
} from "./tourScript";
import { bubblePlacement, type Box, type Placement } from "./tourPlacement";

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

// Panels the bubble should rather not cover (the step's own regions count
// much more).
const PANELS = [
  ".hud",
  ".layers",
  ".companion-dock",
  ".timeline-chart",
  ".timeline-bar",
  ".closeup",
];

function boxOf(element: Element | null): Box | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function findTarget(target: TourTarget): Element | null {
  if ("css" in target) return document.querySelector(target.css);
  if ("hudLabel" in target) {
    const text = t(target.hudLabel);
    return (
      Array.from(document.querySelectorAll(".hud label")).find(
        (item) => item.querySelector("span")?.textContent?.trim() === text,
      ) ?? null
    );
  }
  const name = variableName(target.layer, target.layer);
  const label = Array.from(document.querySelectorAll(".layer-row-name")).find(
    (item) => item.textContent?.trim() === name,
  );
  return label?.closest(".layer-row") ?? null;
}

const MARGIN = 12;

function sameLayout(a: Layout, b: Layout): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type Layout = { rings: Box[]; place: Placement | null };

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
  const [layout, setLayout] = useState<Layout>({ rings: [], place: null });
  const nextButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const current = TOUR_STEPS[step];
  const last = step >= TOUR_STEPS.length - 1;
  const next = () => (last ? onEnd() : onStep(step + 1));
  const back = () => {
    if (step > 0) onStep(step - 1);
  };

  const particleStyle = useParticleStyle();
  // A key with `.general` / `.expert` children is read in the role's voice.
  const messages = (current?.messages ?? [])
    .map((key) => tourMessageKey(key, particleStyle))
    .map((key) => (hasMessage(`${key}.general`) ? `${key}.${voice}` : key));
  const said = current ? sentences(current.speaker) : null;
  const lines = current
    ? [
        ...messages.map((key) => t(key, vars)),
        ...current.lines
          .map((line) => said?.[line] ?? null)
          .filter((line): line is string => !!line),
      ]
    : [];
  const speechLocale = getMessageLocale(
    messages[0] ??
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
        ...messages.map((key) => t(key, { ...vars, month: spokenMonth })),
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
      else if (
        event.key === "Enter" &&
        !(target instanceof HTMLButtonElement) &&
        !(target instanceof HTMLAnchorElement)
      )
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

  // The rings and the bubble follow the panels, which open, slide and
  // resize on their own; a light poll keeps them in place.
  const targets = current?.targets;
  useEffect(() => {
    const measure = () => {
      const bubble = boxOf(root.current);
      const rings = (targets ?? [])
        .map((target) => boxOf(findTarget(target)))
        .filter((box): box is Box => box !== null);
      const panels = PANELS.flatMap((css) =>
        Array.from(document.querySelectorAll(css)).map(boxOf),
      ).filter((box): box is Box => box !== null);
      const place = bubble
        ? bubblePlacement({
            bubble: { width: bubble.width, height: bubble.height },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            targets: rings,
            panels,
            top: 64,
            margin: MARGIN,
          })
        : null;
      const nextLayout = { rings, place };
      setLayout((before) =>
        sameLayout(before, nextLayout) ? before : nextLayout,
      );
    };
    measure();
    const timer = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [targets]);

  if (!current) return null;
  const spec = companionFor(current.speaker);
  const shape = figure(current.speaker);
  const chapterIndex = TOUR_CHAPTERS.findIndex(
    (item) => item === current.chapter,
  );
  const base = import.meta.env.BASE_URL;
  const jumpLabel = (index: number) =>
    t("guide.tour.chapterJump", {
      number: index + 1,
      question: t(`investigation.tabs.${TOUR_CHAPTERS[index]}.question`),
    });

  return (
    <>
      {layout.rings.map((ring, index) => (
        <div
          key={index}
          className="guide-tour-ring"
          aria-hidden="true"
          style={{
            left: Math.max(2, ring.left - 4),
            top: Math.max(2, ring.top - 4),
            width: Math.min(window.innerWidth - 4, ring.width + 8),
            height: Math.min(window.innerHeight - 4, ring.height + 8),
          }}
        />
      ))}
      <section
        ref={root}
        className="guide-tour"
        role="dialog"
        aria-label={t("guide.tour.aria")}
        style={
          layout.place
            ? {
                left: layout.place.left,
                top: layout.place.top,
                transform: "none",
              }
            : undefined
        }
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
          <nav
            className="guide-tour-chapters"
            aria-label={t("guide.tour.chapters")}
          >
            {TOUR_CHAPTERS.map((chapter, index) => (
              <button
                type="button"
                key={chapter}
                aria-current={index === chapterIndex ? "step" : undefined}
                className={index < chapterIndex ? "guide-tour-done" : undefined}
                title={jumpLabel(index)}
                aria-label={jumpLabel(index)}
                onClick={() => onStep(chapterStart(chapter))}
              >
                <span className="guide-tour-chapter-number">{index + 1}</span>
                <span className="guide-tour-chapter-name">
                  {t(`investigation.tabs.${chapter}.short`)}
                </span>
              </button>
            ))}
          </nav>
          <p className="guide-tour-head">
            <strong>{spec ? companionTitle(spec) : ""}</strong>
            {chapterIndex >= 0 ? (
              <span>{t(`investigation.tabs.${current.chapter}.question`)}</span>
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
          {last ? (
            <ul className="guide-tour-next">
              {TOUR_NEXT.map((id) => {
                const example = GUIDE_EXAMPLES.find((item) => item.id === id);
                const href = example
                  ? exampleHref(example, base)
                  : `${base}?role=researcher&layers=merra2_t2m&chart=merra2_t2m&tab=significant`;
                const label = example
                  ? t(`guide.examples.${id}.question`)
                  : t("guide.tour.nextResearcher");
                return (
                  <li key={id}>
                    <a href={href} onClick={onEnd}>
                      {label}
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : null}
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
    </>
  );
}
