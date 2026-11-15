// The guide card: what the tool is, the companion tour, a few examples to
// open, and "How to read this". It describes the tool and how to read the
// picture; it states no findings. Examples are data (examples.ts); every
// text is in the `guide` namespace of the message files.
import { TrendMarkIcon } from "../analysis/TrendMarkIcon";
import type { TrendSignal } from "../forms/encoding";
import { carryChoices, useI18n } from "../i18n";
import { exampleHref, GUIDE_EXAMPLES } from "./examples";
import "./guide.css";
import { HOW_TO_ITEMS } from "./howTo";

const UNRELIABLE_EXAMPLE: TrendSignal = {
  state: "rising",
  fdr: true,
  unreliable: true,
};

type GuideCardProps = {
  onClose: () => void;
  // Starts the companion tour; the button is hidden without it.
  onTour?: () => void;
  // Opens with "How to read this" unfolded (the link in the Layers panel).
  howToOpen?: boolean;
};

export function GuideCard({ onClose, onTour, howToOpen }: GuideCardProps) {
  const { t, tm, settings } = useI18n();
  return (
    <section className="guide-card" aria-label={t("guide.card.aria")}>
      <header>
        <h1>{t("common.appName")}</h1>
        <button
          type="button"
          aria-label={t("guide.card.close")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <p>{tm("guide.card.tagline")}</p>
      {onTour ? (
        <p className="guide-tour-offer">
          <button type="button" className="guide-start" onClick={onTour}>
            {t("guide.card.tour")}
          </button>
          <span>{t("guide.card.tourHint")}</span>
        </p>
      ) : null}
      <h2>{t("guide.card.examples")}</h2>
      <ul className="guide-examples">
        {GUIDE_EXAMPLES.map((example) => (
          <li key={example.id}>
            <a
              href={carryChoices(
                exampleHref(example, import.meta.env.BASE_URL),
              )}
            >
              {t(`guide.examples.${example.id}.question`)}
              <span>
                {t("guide.card.opens", {
                  what: t(`guide.examples.${example.id}.opens`),
                })}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <details open={howToOpen || settings.readingAid}>
        <summary>{t("common.action.howToRead")}</summary>
        <dl>
          {HOW_TO_ITEMS.map((id) => (
            <div key={id}>
              <dt>
                {id === "unreliable" ? (
                  <>
                    <TrendMarkIcon signal={UNRELIABLE_EXAMPLE} />{" "}
                  </>
                ) : null}
                {t(`guide.howto.${id}.term`)}
              </dt>
              <dd>{t(`guide.howto.${id}.text`)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <footer>
        <button type="button" className="guide-start" onClick={onClose}>
          {t("guide.card.start")}
        </button>
        <span>{t("guide.card.reopen")}</span>
      </footer>
    </section>
  );
}
