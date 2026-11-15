// The two choices every page offers: the language (each under its own
// name) and the reader mode. Both switch in place, without a reload.
import {
  chooseLocale,
  chooseRole,
  LOCALE_NAMES,
  LOCALES,
  ROLES,
  useI18n,
  type Locale,
  type Role,
} from "./index";
import { HudIcon } from "../hud/icons";
import "./choices.css";

export function LanguageMenu() {
  const { t, locale } = useI18n();
  return (
    <label className="choice-language">
      <span className="choice-label">{t("common.language.label")}</span>
      <HudIcon name="language" />
      <select
        value={locale}
        aria-label={t("common.language.label")}
        title={t("common.language.label")}
        onChange={(event) => void chooseLocale(event.target.value as Locale)}
      >
        {LOCALES.map((item) => (
          <option key={item} value={item} lang={item}>
            {LOCALE_NAMES[item]}
          </option>
        ))}
      </select>
    </label>
  );
}

// One small drawn icon per role; no icon font or image file.
function RoleIcon({ role }: { role: Role }) {
  const common = {
    viewBox: "0 0 16 16",
    width: 14,
    height: 14,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (role === "everyone") {
    // A person.
    return (
      <svg {...common}>
        <circle cx="8" cy="5" r="2.6" />
        <path d="M2.8 14c.6-3 2.6-4.4 5.2-4.4s4.6 1.4 5.2 4.4" />
      </svg>
    );
  }
  if (role === "student") {
    // An open book.
    return (
      <svg {...common}>
        <path d="M8 4.2C6.4 3 4.3 2.7 2 3v9c2.3-.3 4.4 0 6 1.2 1.6-1.2 3.7-1.5 6-1.2V3c-2.3-.3-4.4 0-6 1.2z" />
        <path d="M8 4.2v9" />
      </svg>
    );
  }
  // A magnifying glass.
  return (
    <svg {...common}>
      <circle cx="6.8" cy="6.8" r="4.2" />
      <path d="M10 10l4 4" />
    </svg>
  );
}

// The three-way role switch of the top bar.
export function RoleSwitch() {
  const { t, role } = useI18n();
  return (
    <div
      className="choice-mode choice-role"
      role="group"
      aria-label={t("common.role.label")}
    >
      {ROLES.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={role === item}
          aria-label={t(`common.role.${item}.hint`)}
          title={t(`common.role.${item}.hint`)}
          onClick={() => chooseRole(item)}
        >
          <RoleIcon role={item} />
          <span>{t(`common.role.${item}.name`)}</span>
        </button>
      ))}
    </div>
  );
}

// The earlier name of the switch (the sub-pages mount it under this name).
export const ModeSwitch = RoleSwitch;
