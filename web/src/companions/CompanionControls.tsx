// Small parts of the companion panel: the three switches on top and the
// lines under a companion's name. Text only through i18n.
import { useI18n } from "../i18n";
import type { DataKind } from "../analysis/modelVsObs";

type SwitchProps = {
  label: string;
  title?: string;
  on: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
};

// A switch has one fixed name; whether it is on shows in its look (lit) and
// in aria-pressed, not in its words.
function Switch({
  label,
  title,
  on,
  onClick,
  className,
  children,
}: SwitchProps) {
  return (
    <button
      type="button"
      className={`companion-switch ${className}${on ? " companion-switch-on" : ""}`}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      <svg viewBox="0 0 20 16" width="15" height="12" aria-hidden="true">
        {children}
      </svg>
      {label}
    </button>
  );
}

type CompanionToolbarProps = {
  // The browser has speech synthesis; without it there is no voice switch.
  canSpeak: boolean;
  voiceOn: boolean;
  narrate: boolean;
  gathered: boolean;
  onVoice: () => void;
  onNarrate: () => void;
  onGather: () => void;
  // More buttons after the three (the Gather view's Close button).
  children?: React.ReactNode;
};

export function CompanionToolbar({
  canSpeak,
  voiceOn,
  narrate,
  gathered,
  onVoice,
  onNarrate,
  onGather,
  children,
}: CompanionToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="companion-tools">
      {canSpeak ? (
        <Switch
          className="companion-voice"
          label={t("companions.voice")}
          title={t("companions.voiceTitle")}
          on={voiceOn}
          onClick={onVoice}
        >
          <path d="M1 5.5h3.5L9 2v12L4.5 10.5H1z" fill="currentColor" />
          <path
            d="M12 4.5a5 5 0 0 1 0 7M14.5 2a8.5 8.5 0 0 1 0 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </Switch>
      ) : null}
      <Switch
        className="companion-narrate"
        label={t("companions.narrate")}
        title={t("companions.narrateTitle")}
        on={narrate}
        onClick={onNarrate}
      >
        <path
          d="M2 2h16v9H9l-4 3.5V11H2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </Switch>
      <Switch
        className="companion-gather-switch"
        label={t("companions.gather.open")}
        title={t("companions.gather.title")}
        on={gathered}
        onClick={onGather}
      >
        <circle cx="10" cy="3.5" r="2.2" fill="currentColor" />
        <circle cx="4" cy="11.5" r="2.2" fill="currentColor" />
        <circle cx="16" cy="11.5" r="2.2" fill="currentColor" />
      </Switch>
      {children}
    </div>
  );
}

type CompanionCaptionProps = {
  // "Warmth · MERRA-2".
  title: string;
  // The month's value with its unit, as the Layers panel writes it.
  reading: string;
  kind: DataKind;
};

// Name, the month's value, and the data source as one small tag.
export function CompanionCaption({
  title,
  reading,
  kind,
}: CompanionCaptionProps) {
  const { t } = useI18n();
  return (
    <span className="companion-caption">
      <span className="companion-name">{title}</span>
      <span className="companion-value">{reading}</span>
      <span className={`companion-kind companion-kind-${kind}`}>
        {t(`common.dataKind.${kind}.short`)}
      </span>
    </span>
  );
}
