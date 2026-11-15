// The companion panel of the main view: one companion per layer that is
// switched on, highest form on top. Clicking one shows its sentence of data
// facts (companionLine.ts); the browser reads it aloud only after the user
// turns the voice on, in the voice of the interface language (English when
// that language is not installed). "Gather" shows all twelve in one
// composition, and ?companions=gallery lays them out for a screenshot.
import { useEffect, useRef, useState } from "react";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendKey, type TrendsFile } from "../analysis/trends";
import { currentSpeechLocale, SPEECH_LOCALE_NAME } from "../i18n/locale";
import { formatMeasurement } from "../snapshot/reading";
import type { LoadedSeries } from "../snapshot/loadSnapshot";
import { Companion } from "./Companion";
import {
  companionReading,
  type CompanionMood,
  type CompanionReading,
} from "./companionData";
import { companionLine, spokenLine } from "./companionLine";
import { GROUND_Y, VIEW_HEIGHT_BARE } from "./companionShape";
import {
  byAltitude,
  COMPANIONS,
  companionTitle,
  DATA_KIND_SHORT,
  type CompanionSpec,
} from "./companionSpec";
import { GATHER_CREDIT, gatherLayout } from "./gather";
import { interactionsFor } from "./interactions";
import { resolvedSpeechLocale } from "./speechVoice";
import { primeSpeech, speak, speechAvailable, stopSpeaking } from "./speech";
import { useCurrentMonth } from "./useCurrentMonth";

export type CompanionDockProps = {
  // Ids of the layers that are switched on.
  visibleIds: string[];
  // The series of the selected place.
  series: LoadedSeries[];
  locationId: string;
  locationName: string;
  // Aggregation of the place's series in the trend keys ("point" except
  // for the global mean).
  aggregation?: string;
  // data/analysis/trends.json once loaded, else null.
  trends: TrendsFile | null;
  // True while the layer view is open: the same companions already stand on
  // its platforms, so the panel folds to a row of small figures.
  compact?: boolean;
};

export const INTERACTION_NOTE =
  "Interactions are illustrative; they do not show cause and effect.";
export const EMPTY_NOTE = "Turn on a layer to meet its companion";

// At or below this width the panel starts collapsed, as a chip under the HUD.
const NARROW_WIDTH = 700;

function requestedMode(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("companions");
}

// Up to this many companions stand in one column (and can interact); more
// are laid out in two columns so the panel stays above the timeline bar.
export const ONE_COLUMN_MAX = 4;

function figureSize(count: number): number {
  if (count <= 3) return 80;
  if (count <= ONE_COLUMN_MAX) return 60;
  return 52;
}

const MOOD_TEXT: Record<CompanionMood, string> = {
  above: "above its usual for the month",
  near: "near its usual for the month",
  below: "below its usual for the month",
};

function Figure({
  spec,
  reading,
  size,
  animate = true,
  showLabel = true,
  warning = true,
  gesture,
  gestureSide,
}: {
  spec: CompanionSpec;
  reading: CompanionReading;
  size: number;
  animate?: boolean;
  showLabel?: boolean;
  // false where the panel draws its own caution button instead.
  warning?: boolean;
  gesture?: "up" | "down";
  gestureSide?: "left" | "right";
}) {
  return (
    <Companion
      variableId={spec.id}
      value={reading.value}
      anomalyZ={reading.anomaly?.z ?? null}
      signal={reading.signal}
      mood={reading.mood}
      warning={warning && reading.caveat !== null}
      size={size}
      animate={animate}
      showLabel={showLabel}
      gesture={gesture}
      gestureSide={gestureSide}
    />
  );
}

function Backdrop() {
  // A few lines only: three receding arches and the steps.
  return (
    <svg
      className="companion-gather-backdrop"
      viewBox="0 0 800 450"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g fill="none" stroke="#b7c6da" strokeOpacity={0.4} strokeWidth={2}>
        <path d="M90 284V170a310 160 0 0 1 620 0V284" />
        <path d="M200 258V160a200 116 0 0 1 400 0V258" />
        <path d="M285 236V150a115 76 0 0 1 230 0V236" />
        <path d="M285 236H515" />
      </g>
      <g stroke="#b7c6da" strokeOpacity={0.3} strokeWidth={1.5}>
        <path d="M200 258H285M515 258H600" />
        <path d="M60 286H740" />
        <path d="M40 320H760" />
        <path d="M20 360H780" />
        <path d="M0 408H800" />
      </g>
    </svg>
  );
}

export function CompanionDock({
  visibleIds,
  series,
  locationId,
  locationName,
  aggregation = "point",
  trends,
  compact = false,
}: CompanionDockProps) {
  const { month, playing } = useCurrentMonth();
  const [mode] = useState(requestedMode);
  const [compactOpen, setCompactOpen] = useState(false);
  const [userCollapsed, setCollapsed] = useState(
    () =>
      mode === "collapsed" ||
      (typeof window !== "undefined" && window.innerWidth <= NARROW_WIDTH),
  );
  const collapsed = compact ? !compactOpen : userCollapsed;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caveatOpen, setCaveatOpen] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [installedVoices, setInstalledVoices] = useState<
    SpeechSynthesisVoice[]
  >([]);
  const [gathered, setGathered] = useState(mode === "gather");
  const [gallery, setGallery] = useState(mode === "gallery");
  const canSpeak = speechAvailable();

  const readings: Record<string, CompanionReading> = {};
  const lines: Record<string, string> = {};
  for (const spec of COMPANIONS) {
    const found = series.find((item) => item.variableId === spec.id);
    const trend = trends?.series[trendKey(spec.id, locationId, aggregation)];
    const reading = companionReading(
      spec.id,
      found,
      month,
      trend,
      trends?.known_issues,
    );
    readings[spec.id] = reading;
    lines[spec.id] = companionLine({
      variableName: spec.variableName,
      place: locationName,
      month,
      value: reading.raw,
      unit: reading.unit,
      anomaly: reading.anomaly,
      trend,
      alpha: trends?.parameters.alpha,
      caveatSummary: reading.caveat?.summary,
      unreliableReason: reading.signal.unreliable
        ? (reading.caveat?.reason ?? "it has a documented data issue.")
        : null,
      dataKind: spec.dataKind,
    });
  }

  const shown = byAltitude(visibleIds);
  const selected =
    COMPANIONS.find(
      (spec) =>
        spec.id === selectedId &&
        (gathered || gallery || visibleIds.includes(spec.id)),
    ) ?? null;
  const selectedLine = selected ? (lines[selected.id] ?? "") : "";
  const oneColumn = shown.length <= ONE_COLUMN_MAX;
  const interactions = oneColumn ? interactionsFor(shown) : [];
  const size = figureSize(shown.length);

  // Speak when playback pauses, never on every month while it runs.
  const wasPlaying = useRef(playing);
  useEffect(() => {
    if (wasPlaying.current && !playing && voiceOn && selectedLine) {
      speak(spokenLine(selectedLine), currentSpeechLocale());
    }
    wasPlaying.current = playing;
  }, [playing, voiceOn, selectedLine]);
  useEffect(() => {
    primeSpeech();
    if (!speechAvailable()) return stopSpeaking;
    const take = () => setInstalledVoices(window.speechSynthesis.getVoices());
    take();
    window.speechSynthesis.addEventListener("voiceschanged", take);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", take);
      stopSpeaking();
    };
  }, []);
  // Esc closes the Gather composition, the same as its Close button.
  useEffect(() => {
    if (!gathered) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setGathered(false);
      setSelectedId(null);
      stopSpeaking();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gathered]);

  function select(id: string, withCaveat = false) {
    const closing = selectedId === id && caveatOpen === withCaveat;
    setSelectedId(closing ? null : id);
    setCaveatOpen(withCaveat);
    if (closing) stopSpeaking();
    else if (voiceOn && !playing)
      speak(spokenLine(lines[id] ?? ""), currentSpeechLocale());
  }

  function toggleVoice() {
    if (voiceOn) stopSpeaking();
    else if (selectedLine)
      speak(spokenLine(selectedLine), currentSpeechLocale());
    setVoiceOn(!voiceOn);
  }

  const bubble = selected ? (
    <div className="companion-bubble" role="status">
      <p className="companion-bubble-title">
        {companionTitle(selected)}
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            setSelectedId(null);
            stopSpeaking();
          }}
        >
          ×
        </button>
      </p>
      <p className="companion-bubble-line">{selectedLine}</p>
      <p className="companion-bubble-pose">
        Shape: {MOOD_TEXT[readings[selected.id]?.mood ?? "near"]}.
      </p>
      {caveatOpen && readings[selected.id]?.caveat ? (
        <TrendCaveatNote
          caveat={
            readings[selected.id]?.caveat ?? {
              summary: "",
              details: "",
              sources: "",
            }
          }
        />
      ) : null}
    </div>
  ) : null;

  const speechLocale = resolvedSpeechLocale(
    installedVoices,
    currentSpeechLocale(),
  );
  const controls = (
    <>
      {canSpeak ? (
        <button
          type="button"
          className="companion-voice"
          aria-pressed={voiceOn}
          aria-label={
            voiceOn
              ? `Turn the ${SPEECH_LOCALE_NAME[speechLocale]} voice off`
              : `Read the selected companion aloud in ${SPEECH_LOCALE_NAME[speechLocale]}`
          }
          title={`Browser voice for ${SPEECH_LOCALE_NAME[speechLocale]}`}
          onClick={toggleVoice}
        >
          <svg viewBox="0 0 20 16" width="15" height="12" aria-hidden="true">
            <path d="M1 5.5h3.5L9 2v12L4.5 10.5H1z" fill="currentColor" />
            {voiceOn ? (
              <path
                d="M12 4.5a5 5 0 0 1 0 7M14.5 2a8.5 8.5 0 0 1 0 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M12.5 5l5 6M17.5 5l-5 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )}
          </svg>
          {voiceOn ? "Voice on" : "Voice off"}
        </button>
      ) : null}
    </>
  );

  if (gallery) {
    return (
      <section
        className="companion-dock companion-gallery"
        aria-label="Data companions gallery"
      >
        <header className="companion-head">
          <p className="companion-heading">
            Data companions · {locationName}
            {month ? ` · ${month.slice(0, 7)}` : ""}
          </p>
          <button type="button" onClick={() => setGallery(false)}>
            Close
          </button>
        </header>
        <ul className="companion-gallery-grid">
          {byAltitude(COMPANIONS.map((spec) => spec.id)).map((spec) => {
            const reading = readings[spec.id];
            if (!reading) return null;
            return (
              <li key={spec.id}>
                <Figure spec={spec} reading={reading} size={128} />
                <p className="companion-name">{companionTitle(spec)}</p>
                <p className="companion-sub">
                  {spec.variableName} ·{" "}
                  {formatMeasurement(reading.raw, reading.unit)}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="companion-heading">
          Posture (same companion): below usual, near usual, above usual, no
          data
        </p>
        <ul className="companion-gallery-grid companion-gallery-postures">
          {(["below", "near", "above"] as const).map((mood, index) => (
            <li key={mood}>
              <Companion
                variableId="imerg_precip"
                value={[0.1, 0.5, 1][index] ?? 0.5}
                mood={mood}
                trend={[-1, 0, 1][index]}
                significant={index !== 1}
                size={96}
              />
              <p className="companion-sub">
                {mood} · value {[0.1, 0.5, 1][index]}
              </p>
            </li>
          ))}
          <li>
            <Companion variableId="imerg_precip" value={null} size={96} />
            <p className="companion-sub">no data</p>
          </li>
          {([-2, -1, 0, 1, 2] as const).map((z) => (
            <li key={z}>
              <Companion
                variableId="merra2_t2m"
                value={0.5 + z * 0.2}
                anomalyZ={z}
                size={96}
              />
              <p className="companion-sub">anomaly z = {z}</p>
            </li>
          ))}
        </ul>
        <p className="companion-foot">
          Drawn by code (SVG). Size: value within the series&apos; own range.
          Posture: month against the mean of the same calendar month. Mark: ▲ ▼
          significant trend, ◇ not significant, a crossed-out triangle for a
          significant trend that is not reliable as a climate signal.{" "}
          {INTERACTION_NOTE}
        </p>
      </section>
    );
  }

  const gatherPlaces = gathered ? gatherLayout(COMPANIONS, visibleIds) : [];

  return (
    <>
      <aside
        className={`companion-dock${collapsed ? " companion-dock-collapsed" : oneColumn ? "" : " companion-dock-wide"}`}
        aria-label="Data companions"
      >
        <header className="companion-head">
          <p className="companion-heading">Companions</p>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand companions" : "Collapse companions"}
            onClick={() =>
              compact ? setCompactOpen(!compactOpen) : setCollapsed(!collapsed)
            }
          >
            {collapsed ? "+" : "–"}
          </button>
        </header>
        {collapsed ? (
          <ul className="companion-avatars">
            {shown.map((spec) => {
              const reading = readings[spec.id];
              return reading ? (
                <li key={spec.id} title={companionTitle(spec)}>
                  <Figure
                    spec={spec}
                    reading={reading}
                    size={30}
                    animate={false}
                    showLabel={false}
                  />
                </li>
              ) : null;
            })}
            {shown.length === 0 ? (
              <li className="companion-sub">No layer on</li>
            ) : null}
          </ul>
        ) : (
          <>
            <div className="companion-tools">
              {controls}
              <button type="button" onClick={() => setGathered(true)}>
                Gather
              </button>
            </div>
            {shown.length === 0 ? (
              <div className="companion-empty-state">
                <Companion
                  variableId="imerg_precip"
                  value={null}
                  size={76}
                  showLabel={false}
                />
                <p>{EMPTY_NOTE}</p>
              </div>
            ) : (
              <ol
                className={`companion-list${oneColumn ? "" : " companion-list-two"}`}
              >
                {shown.map((spec) => {
                  const reading = readings[spec.id];
                  if (!reading) return null;
                  const below = interactions.find(
                    (item) =>
                      item.upperId === spec.id && item.effect !== "glow",
                  );
                  const lit = interactions.find(
                    (item) => item.litId === spec.id,
                  );
                  return (
                    <li
                      key={spec.id}
                      className={`companion-item${lit ? " companion-lit" : ""}${selectedId === spec.id ? " companion-selected" : ""}`}
                      title={lit?.note}
                    >
                      <button
                        type="button"
                        className="companion-figure"
                        aria-pressed={selectedId === spec.id}
                        aria-label={`${companionTitle(spec)}: say the numbers`}
                        onClick={() => select(spec.id)}
                      >
                        <Figure
                          spec={spec}
                          reading={reading}
                          size={size}
                          showLabel={false}
                          warning={false}
                        />
                        <span className="companion-name">
                          {companionTitle(spec)}
                          <span className="companion-sub">
                            {" "}
                            {DATA_KIND_SHORT[spec.dataKind]}
                          </span>
                        </span>
                      </button>
                      {reading.caveat ? (
                        <button
                          type="button"
                          className="companion-caution"
                          aria-label={`${companionTitle(spec)}: known problem, show the caution`}
                          title="Known problem with this trend"
                          onClick={() => select(spec.id, true)}
                        >
                          !
                        </button>
                      ) : null}
                      {below ? (
                        <span
                          className={`companion-link companion-link-${below.effect}`}
                          title={below.note}
                          aria-hidden="true"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="companion-foot">
              Click one for its numbers. {INTERACTION_NOTE}
            </p>
          </>
        )}
        {!gathered ? bubble : null}
      </aside>
      {gathered ? (
        <section
          className="companion-dock companion-gather"
          aria-label="Gather: all companions"
        >
          <header className="companion-head">
            <p className="companion-heading">
              Gather · {locationName}
              {month ? ` · ${month.slice(0, 7)}` : ""}
            </p>
            <div className="companion-tools">
              {controls}
              <button
                type="button"
                onClick={() => {
                  setGathered(false);
                  setSelectedId(null);
                  stopSpeaking();
                }}
              >
                Close
              </button>
            </div>
          </header>
          <div className="companion-gather-stage">
            <Backdrop />
            {gatherPlaces.map((place) => {
              const spec = COMPANIONS.find((item) => item.id === place.id);
              const reading = readings[place.id];
              if (!spec || !reading) return null;
              return (
                <button
                  key={place.id}
                  type="button"
                  className={`companion-gather-figure${selectedId === place.id ? " companion-selected" : ""}`}
                  aria-label={`${companionTitle(spec)}: say the numbers`}
                  aria-pressed={selectedId === place.id}
                  style={{
                    left: `${place.x * 100}%`,
                    top: `${place.y * 100}%`,
                    width: `${place.scale * 11}%`,
                    transform: `translate(-50%, ${(-GROUND_Y / VIEW_HEIGHT_BARE) * 100}%)`,
                    zIndex: Math.round(place.y * 100),
                  }}
                  onClick={() => select(place.id)}
                >
                  <Figure
                    spec={spec}
                    reading={reading}
                    size={96}
                    showLabel={false}
                    gesture={place.gesture ?? undefined}
                    gestureSide={place.gestureSide}
                  />
                  <span className="companion-name">{companionTitle(spec)}</span>
                </button>
              );
            })}
          </div>
          {bubble}
          <p className="companion-foot">
            In the middle, a form of the sky or air points up and a form of the
            surface or ground holds a palm down; higher forms stand on the upper
            steps. The arrangement is illustrative and shows no cause and
            effect. {GATHER_CREDIT}
          </p>
        </section>
      ) : null}
    </>
  );
}
