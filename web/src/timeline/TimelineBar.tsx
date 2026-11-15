import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { StripBar } from "./seriesMath";
import { useTimeline } from "./TimelineContext";
import {
  clampSpeed,
  monthLabel,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
} from "./timelineMath";

type TimelineBarProps = {
  // Anomaly strip above the slider: one bar per month of `stripName`.
  strip: StripBar[];
  stripName: string | null;
  // Indices (into the timeline's months) of documented step months.
  breaks: number[];
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A", "SUMMARY"].includes(
      target.tagName,
    )
  );
}

// The bar at the bottom of the main view: play/pause, the month slider with
// the anomaly strip, the current month, the speed and "Latest". It reads and
// writes the timeline context only.
export function TimelineBar({ strip, stripName, breaks }: TimelineBarProps) {
  const {
    months,
    monthIndex,
    month,
    setMonthIndex,
    step,
    defaultMonth,
    setMonth,
    playing,
    setPlaying,
    speed,
    setSpeed,
  } = useTimeline();
  const { t, tm } = useI18n();
  // What is typed in the speed box while it is being edited; null otherwise.
  const [speedDraft, setSpeedDraft] = useState<string | null>(null);

  // Space plays or pauses, the arrow keys step one month. Keys typed into a
  // form control (or pressed on a focused button or link) are left alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      if (event.key === " ") {
        event.preventDefault();
        setPlaying(!playing);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, setPlaying, step]);

  if (!month || monthIndex < 0) return null;
  const label = monthLabel(month);
  const count = months.length;
  const speedText = t("timeline.speedTitle", { count: speed });
  const changeSpeed = (value: number) => {
    const next = clampSpeed(value);
    if (next !== null) setSpeed(next);
    setSpeedDraft(null);
  };
  // Leaving the number box (or Enter) snaps what was typed to an allowed
  // speed; an empty box or text that is not a number goes back to the
  // current speed.
  const commitSpeedDraft = () => {
    if (speedDraft === null) return;
    if (speedDraft.trim() === "") setSpeedDraft(null);
    else changeSpeed(Number(speedDraft));
  };

  return (
    <section className="timeline-bar" aria-label={t("timeline.aria")}>
      <div className="timeline-row">
        <button
          type="button"
          className="timeline-play"
          aria-label={t(playing ? "timeline.pause" : "timeline.play")}
          title={t("timeline.playTitle")}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <p className="timeline-now" aria-live="off">
          {label.map((part, index) =>
            part.year ? (
              <strong key={index}>{part.text}</strong>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
        <div
          className="timeline-speed"
          role="group"
          aria-label={t("timeline.speed")}
        >
          <button
            type="button"
            aria-label={t("timeline.slower")}
            title={t("timeline.slower")}
            disabled={speed <= SPEED_MIN}
            onClick={() => changeSpeed(speed - SPEED_STEP)}
          >
            −
          </button>
          <input
            type="range"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={SPEED_STEP}
            value={speed}
            aria-label={t("timeline.speed")}
            aria-valuetext={speedText}
            title={speedText}
            onChange={(event) => changeSpeed(Number(event.target.value))}
          />
          <button
            type="button"
            aria-label={t("timeline.faster")}
            title={t("timeline.faster")}
            disabled={speed >= SPEED_MAX}
            onClick={() => changeSpeed(speed + SPEED_STEP)}
          >
            +
          </button>
          <label className="timeline-speed-value" title={speedText}>
            <input
              type="number"
              inputMode="decimal"
              min={SPEED_MIN}
              max={SPEED_MAX}
              step={SPEED_STEP}
              value={speedDraft ?? String(speed)}
              aria-label={t("timeline.speedInput")}
              onChange={(event) => {
                setSpeedDraft(event.target.value);
                // Apply right away when the text is already an allowed speed,
                // so typing "3" plays at 3× without leaving the box.
                const typed = Number(event.target.value);
                if (event.target.value !== "" && clampSpeed(typed) === typed) {
                  setSpeed(typed);
                }
              }}
              onBlur={commitSpeedDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitSpeedDraft();
                if (event.key === "Escape") setSpeedDraft(null);
              }}
            />
            ×
          </label>
        </div>
        <button
          type="button"
          className="timeline-latest"
          title={t("timeline.latestTitle")}
          disabled={!defaultMonth || defaultMonth === month}
          onClick={() => {
            setPlaying(false);
            if (defaultMonth) setMonth(defaultMonth);
          }}
        >
          {t("timeline.latest")}
        </button>
      </div>
      <div className="timeline-track">
        {strip.length > 0 ? (
          <svg
            className="timeline-strip"
            viewBox={`0 0 ${count} 2`}
            preserveAspectRatio="none"
            role="img"
            aria-label={t("timeline.strip.aria", {
              name: stripName ?? t("timeline.strip.ariaFallback"),
            })}
          >
            <line
              className="timeline-strip-zero"
              x1={0}
              x2={count}
              y1={1}
              y2={1}
            />
            {strip.map((bar) => (
              <rect
                key={bar.index}
                className={
                  bar.level >= 0 ? "timeline-strip-high" : "timeline-strip-low"
                }
                x={bar.index}
                width={1}
                y={bar.level >= 0 ? 1 - bar.level : 1}
                height={Math.abs(bar.level)}
              />
            ))}
            {breaks.map((index) => (
              <line
                key={index}
                className="timeline-strip-break"
                x1={index + 0.5}
                x2={index + 0.5}
                y1={0}
                y2={2}
              />
            ))}
            <line
              className="timeline-strip-cursor"
              x1={monthIndex + 0.5}
              x2={monthIndex + 0.5}
              y1={0}
              y2={2}
            />
          </svg>
        ) : null}
        <input
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={monthIndex}
          aria-label={t("timeline.slider")}
          aria-valuetext={month.slice(0, 7)}
          onChange={(event) => setMonthIndex(Number(event.target.value))}
        />
        <p className="timeline-ends">
          <span>{months[0]?.slice(0, 7)}</span>
          {strip.length > 0 && stripName ? (
            <span className="timeline-strip-key">
              <i className="timeline-strip-high" /> {t("timeline.strip.above")}{" "}
              / <i className="timeline-strip-low" />{" "}
              {tm("timeline.strip.below", { name: stripName })}
              {breaks.length > 0 ? (
                <>
                  {" "}
                  · <i className="timeline-strip-break" />{" "}
                  {tm("timeline.strip.step")}
                </>
              ) : null}
            </span>
          ) : null}
          <span>{months.at(-1)?.slice(0, 7)}</span>
        </p>
      </div>
    </section>
  );
}
