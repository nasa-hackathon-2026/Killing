// The companion panel of the main view: one companion per layer that is
// switched on, highest form on top. Clicking one shows its sentence of data
// facts (companionLine.ts); the browser reads it aloud only after the user
// turns the voice on, using the language of the displayed companion text.
// "Gather" shows all twelve in one
// composition, and ?companions=gallery lays them out for a screenshot.
import { useEffect, useRef, useState } from "react";
import { TrendCaveatNote } from "../analysis/TrendCaveatNote";
import { trendKey, type TrendsFile } from "../analysis/trends";
import { getMessageLocale, rememberFlag, storedFlag, useI18n } from "../i18n";
import { variableDefinition } from "../i18n/names";
import { formatMeasurement } from "../snapshot/reading";
import { UnitText } from "../snapshot/UnitText";
import type { LoadedSeries } from "../snapshot/loadSnapshot";
import { Companion } from "./Companion";
import { companionReading, type CompanionReading } from "./companionData";
import { companionSpeechParts, spokenLine } from "./companionLine";
import { GROUND_Y, VIEW_HEIGHT_BARE } from "./companionShape";
import {
  byAltitude,
  COMPANIONS,
  companionName,
  companionTitle,
  companionCount,
  companionVariable,
  dataKindShort,
  othersByAltitude,
  type CompanionSpec,
} from "./companionSpec";
import { gatherLayout } from "./gather";
import {
  clickSelection,
  nextNarration,
  type NarrationState,
} from "./narration";
import { interactionsFor } from "./interactions";
import { shouldSpeakLine } from "./speechPolicy";
import { voiceForLocale } from "./speechVoice";
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
  // Turns a layer on: the small figures of the layers that are off call it.
  onTurnOn?: (variableId: string) => void;
  // False while the guided tour is open: the panel then does not speak up by
  // itself (a click on a companion still opens its bubble).
  autoIntro?: boolean;
};

// Whether companions speak up by themselves (the "Guide on/off" button); a
// stored choice wins over the role's default.
export const NARRATION_STORAGE_KEY = "estd.narrate";

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
  onTurnOn,
  autoIntro = true,
}: CompanionDockProps) {
  const { month, playing } = useCurrentMonth();
  const { t, voice, settings, locale } = useI18n();
  const [mode] = useState(requestedMode);
  const [narrateChoice, setNarrateChoice] = useState(() =>
    storedFlag(NARRATION_STORAGE_KEY),
  );
  const narrate = narrateChoice ?? settings.narration;
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
  const speechLocale = getMessageLocale(
    voice === "expert" ? "companions.line.noMonth" : "companions.say.noMonth",
  );
  const selectedVoice = voiceForLocale(installedVoices, speechLocale);
  const voiceAvailable = selectedVoice !== null;

  const readings: Record<string, CompanionReading> = {};
  const lines: Record<string, string> = {};
  const displayParts: Record<string, string[]> = {};
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
    const lineInput = {
      companionName: companionName(spec),
      definition: variableDefinition(spec.id, "general"),
      variableName: companionVariable(spec),
      place: locationName,
      month,
      value: reading.raw,
      unit: reading.unit,
      anomaly: reading.anomaly,
      trend,
      alpha: trends?.parameters.alpha,
      caveatSummary: reading.caveat?.summary,
      unreliableReason: reading.signal.unreliable
        ? (reading.caveat?.reason ?? t("caveats.genericReason"))
        : null,
      dataKind: spec.dataKind,
    };
    displayParts[spec.id] = companionSpeechParts(lineInput, voice);
    lines[spec.id] = companionSpeechParts(
      { ...lineInput, formatLocale: speechLocale },
      voice,
    ).join(" ");
  }

  const shown = byAltitude(visibleIds);
  const others = othersByAltitude(visibleIds);
  const count = companionCount(visibleIds);
  const selected =
    COMPANIONS.find(
      (spec) =>
        spec.id === selectedId &&
        (gathered || gallery || visibleIds.includes(spec.id)),
    ) ?? null;
  const oneColumn = shown.length <= ONE_COLUMN_MAX;
  const interactions = oneColumn ? interactionsFor(shown) : [];
  const size = figureSize(shown.length);

  // Narration: a companion speaks up when a layer is turned on, the place
  // changes or the timeline pauses (narration.ts decides; this only applies
  // it). The comparison runs while rendering, the way React recommends for
  // state derived from props.
  const [narration, setNarration] = useState<NarrationState>({
    visibleIds,
    locationId,
    playing,
  });
  if (
    narration.visibleIds !== visibleIds ||
    narration.locationId !== locationId ||
    narration.playing !== playing
  ) {
    const next = { visibleIds, locationId, playing };
    const speaker =
      narrate && autoIntro && !collapsed && !gathered && !gallery
        ? nextNarration(
            narration,
            next,
            selectedId,
            shown.map((s) => s.id),
          )
        : null;
    setNarration(next);
    if (speaker && speaker !== selectedId) {
      setSelectedId(speaker);
      setCaveatOpen(false);
    }
  }
  // The voice follows what the bubble shows, when it is on.
  const spokenFor = useRef<string | null>(null);
  const wasPlaying = useRef(playing);
  useEffect(() => {
    const justPaused = wasPlaying.current;
    wasPlaying.current = playing;
    const line = selectedId ? lines[selectedId] : null;
    const key =
      selectedId && line
        ? `${selectedId}|${locationId}|${locale}|${voice}`
        : null;
    if (
      !shouldSpeakLine({
        voiceOn,
        playing,
        wasPlaying: justPaused,
        voiceAvailable,
        key,
        spokenFor: spokenFor.current,
      })
    ) {
      return;
    }
    spokenFor.current = key;
    speak(spokenLine(line ?? ""), speechLocale);
    // `lines` is rebuilt every render; the key above is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    voiceOn,
    playing,
    selectedId,
    locationId,
    locale,
    voice,
    speechLocale,
    voiceAvailable,
  ]);
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
    const next = clickSelection(
      { id: selectedId, caveat: caveatOpen },
      id,
      withCaveat,
    );
    setSelectedId(next.id);
    setCaveatOpen(next.caveat);
    if (next.id === null) {
      spokenFor.current = null;
      stopSpeaking();
    }
  }

  function toggleNarrate() {
    rememberFlag(NARRATION_STORAGE_KEY, !narrate);
    setNarrateChoice(!narrate);
  }

  function toggleVoice() {
    if (voiceOn && voiceAvailable) {
      spokenFor.current = null;
      stopSpeaking();
    }
    setVoiceOn(!voiceOn && voiceAvailable);
  }

  useEffect(() => {
    if (voiceOn && !voiceAvailable) {
      spokenFor.current = null;
      stopSpeaking();
    }
  }, [voiceOn, voiceAvailable]);

  const bubble = selected ? (
    <div className="companion-bubble" role="status">
      <p className="companion-bubble-title">
        {companionTitle(selected)}
        <button
          type="button"
          aria-label={t("common.action.close")}
          onClick={() => {
            spokenFor.current = null;
            setSelectedId(null);
            stopSpeaking();
          }}
        >
          ×
        </button>
      </p>
      <ul className="companion-bubble-facts">
        {(displayParts[selected.id] ?? []).map((part) => (
          <li key={part}>
            <UnitText text={part} />
          </li>
        ))}
      </ul>
      <p className="companion-bubble-pose">
        {t(`companions.shape.${readings[selected.id]?.mood ?? "near"}`)}
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

  const controls = (
    <>
      {canSpeak ? (
        <button
          type="button"
          className="companion-voice"
          aria-pressed={voiceOn && voiceAvailable}
          aria-label={t(
            voiceAvailable
              ? voiceOn
                ? "companions.voiceOn"
                : "companions.voiceOff"
              : "companions.voiceUnavailable",
          )}
          title={t(
            voiceAvailable
              ? "companions.voiceTitle"
              : "companions.voiceUnavailable",
          )}
          disabled={!voiceAvailable}
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
          {voiceAvailable
            ? t(voiceOn ? "companions.voiceOn" : "companions.voiceOff")
            : null}
        </button>
      ) : null}
      <button
        type="button"
        className="companion-narrate"
        aria-pressed={narrate}
        title={t("companions.narrateTitle")}
        onClick={toggleNarrate}
      >
        {t(narrate ? "companions.narrateOn" : "companions.narrateOff")}
      </button>
    </>
  );

  if (gallery) {
    return (
      <section
        className="companion-dock companion-gallery"
        aria-label={t("companions.gallery.aria")}
      >
        <header className="companion-head">
          <p className="companion-heading">
            {t("companions.gallery.title")} · {locationName}
            {month ? ` · ${month.slice(0, 7)}` : ""}
          </p>
          <button type="button" onClick={() => setGallery(false)}>
            {t("common.action.close")}
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
                  {companionVariable(spec)} ·{" "}
                  <UnitText
                    text={formatMeasurement(reading.raw, reading.unit)}
                  />
                </p>
              </li>
            );
          })}
        </ul>
        <p className="companion-heading">{t("companions.gallery.postures")}</p>
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
                {t(`companions.gallery.${mood}`)} ·{" "}
                {t("companions.gallery.value", {
                  value: [0.1, 0.5, 1][index] ?? 0.5,
                })}
              </p>
            </li>
          ))}
          <li>
            <Companion variableId="imerg_precip" value={null} size={96} />
            <p className="companion-sub">{t("companions.gallery.noData")}</p>
          </li>
          {([-2, -1, 0, 1, 2] as const).map((z) => (
            <li key={z}>
              <Companion
                variableId="merra2_t2m"
                value={0.5 + z * 0.2}
                anomalyZ={z}
                size={96}
              />
              <p className="companion-sub">
                {t("companions.gallery.anomaly", { z })}
              </p>
            </li>
          ))}
        </ul>
        <p className="companion-foot">
          {t("companions.gallery.foot")} {t("companions.interactionNote")}
        </p>
      </section>
    );
  }

  const gatherPlaces = gathered ? gatherLayout(COMPANIONS, visibleIds) : [];

  return (
    <>
      <aside
        className={`companion-dock${collapsed ? " companion-dock-collapsed" : oneColumn ? "" : " companion-dock-wide"}`}
        aria-label={t("companions.aria")}
      >
        <header className="companion-head">
          <p className="companion-heading">
            {t("companions.headingCount", {
              shown: count.shown,
              total: count.total,
            })}
          </p>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={t(
              collapsed ? "companions.expand" : "companions.collapse",
            )}
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
              <li className="companion-sub">{t("companions.noLayer")}</li>
            ) : null}
          </ul>
        ) : (
          <>
            <div className="companion-tools">
              {controls}
              <button
                type="button"
                title={t("companions.gather.aria")}
                onClick={() => setGathered(true)}
              >
                {t("companions.gather.button", { count: count.total })}
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
                <p>{t("companions.empty")}</p>
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
                      title={
                        lit
                          ? t(`companions.interactions.${lit.key}`)
                          : undefined
                      }
                    >
                      <button
                        type="button"
                        className="companion-figure"
                        aria-pressed={selectedId === spec.id}
                        aria-label={t("companions.sayAria", {
                          name: companionTitle(spec),
                        })}
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
                            {dataKindShort(spec.dataKind)}
                          </span>
                        </span>
                      </button>
                      {reading.caveat ? (
                        <button
                          type="button"
                          className="companion-caution"
                          aria-label={t("companions.cautionAria", {
                            name: companionTitle(spec),
                          })}
                          title={t("companions.cautionTitle")}
                          onClick={() => select(spec.id, true)}
                        >
                          !
                        </button>
                      ) : null}
                      {below ? (
                        <span
                          className={`companion-link companion-link-${below.effect}`}
                          title={t(`companions.interactions.${below.key}`)}
                          aria-hidden="true"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
            {others.length > 0 && onTurnOn ? (
              <ul
                className="companion-rest"
                aria-label={t("companions.restLabel")}
                title={t("companions.restLabel")}
              >
                {others.map((spec) => {
                  const reading = readings[spec.id];
                  if (!reading) return null;
                  const noData = !series.some(
                    (item) => item.variableId === spec.id,
                  );
                  const args = {
                    name: companionTitle(spec),
                    layer: companionVariable(spec),
                    place: locationName,
                  };
                  return (
                    <li key={spec.id}>
                      <button
                        type="button"
                        className={`companion-rest-button${noData ? " companion-rest-nodata" : ""}`}
                        aria-label={t(
                          noData
                            ? "companions.turnOnNoDataAria"
                            : "companions.turnOnAria",
                          args,
                        )}
                        title={t(
                          noData
                            ? "companions.turnOnNoDataTitle"
                            : "companions.turnOnTitle",
                          args,
                        )}
                        onClick={() => onTurnOn(spec.id)}
                      >
                        <Figure
                          spec={spec}
                          reading={reading}
                          size={26}
                          animate={false}
                          showLabel={false}
                          warning={false}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <p className="companion-foot">
              {t("companions.foot")} {t("companions.interactionNote")}
            </p>
          </>
        )}
        {!gathered ? bubble : null}
      </aside>
      {gathered ? (
        <section
          className="companion-dock companion-gather"
          aria-label={t("companions.gather.aria")}
        >
          <header className="companion-head">
            <p className="companion-heading">
              {t("companions.gather.open")} · {locationName}
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
                {t("common.action.close")}
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
                  aria-label={t("companions.sayAria", {
                    name: companionTitle(spec),
                  })}
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
            {t("companions.gather.foot")} {t("companions.gather.credit")}
          </p>
        </section>
      ) : null}
    </>
  );
}
