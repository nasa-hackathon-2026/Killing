import { useI18n } from "../i18n";
import "./strata.css";

// Offered once the user has zoomed in on the globe; never switches by itself.
// Kept apart from StrataView so the layer view's code (a second canvas) is
// only loaded when the reader enters it (#201).
export function StrataHint({
  placeName,
  onEnter,
}: {
  placeName: string;
  onEnter: () => void;
}) {
  const { t } = useI18n();
  return (
    <button type="button" className="strata-hint" onClick={onEnter}>
      {t("strata.hint", { place: placeName })}
    </button>
  );
}
