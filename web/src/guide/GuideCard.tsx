// The start card: what the tool is, three steps, a few examples to open, and
// a short "How to read this". It describes the tool and how to read the
// picture; it states no findings. Examples are data (examples.ts).
import { exampleHref, GUIDE_EXAMPLES } from "./examples";
import "./guide.css";

const GUIDE_TAGLINE =
  "Pick an Earth-system variable, watch up to 25 years of it at one place, and see whether the change is statistically significant.";

const GUIDE_STEPS = [
  "Turn on a layer in the Layers panel.",
  "Press play or drag the timeline.",
  "Open Chart for the trend and its significance.",
];

export function GuideCard({ onClose }: { onClose: () => void }) {
  return (
    <section className="guide-card" aria-label="Getting started">
      <header>
        <h1>Earth System Trend Detective</h1>
        <button type="button" aria-label="Close the guide" onClick={onClose}>
          ×
        </button>
      </header>
      <p>{GUIDE_TAGLINE}</p>
      <ol>
        {GUIDE_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2>Try an example</h2>
      <ul className="guide-examples">
        {GUIDE_EXAMPLES.map((example) => (
          <li key={example.id}>
            <a href={exampleHref(example, import.meta.env.BASE_URL)}>
              {example.question}
              <span>Opens: {example.opens}</span>
            </a>
          </li>
        ))}
      </ul>
      <details>
        <summary>How to read this</summary>
        <dl>
          <dt>Particles</dt>
          <dd>
            Each layer is drawn as particles. Their count, size and speed follow
            the value at the selected place in the month shown, relative to that
            place&apos;s own record. Flow direction is illustrative; there is no
            wind data.
          </dd>
          <dt>Trend</dt>
          <dd>
            The linear change of monthly anomalies (the value minus the mean of
            the same calendar month) per decade, with a 95% confidence interval.
          </dd>
          <dt>▲ ▼ ◇</dt>
          <dd>
            ▲ rising and ▼ falling mark trends that are statistically
            significant after the autocorrelation and FDR corrections. ◇ is not
            significant.
          </dd>
          <dt>Not significant</dt>
          <dd>
            Not significant does not mean no change; the record may be too short
            or too variable to tell.
          </dd>
          <dt>In situ · Satellite · Model</dt>
          <dd>
            In situ is measured by an instrument at the place. Satellite is
            retrieved from what a sensor in orbit measures. Model is computed by
            a model or reanalysis that combines observations with physics. They
            are different kinds of evidence, so each value says which one it is.
          </dd>
          <dt>Caution notes</dt>
          <dd>
            An orange note marks a documented problem with a series, such as a
            step when an input to the product changed. Open Details for the
            numbers and sources.
          </dd>
        </dl>
      </details>
      <footer>
        <button type="button" className="guide-start" onClick={onClose}>
          Start exploring
        </button>
        <span>Reopen this any time with the ? Guide button.</span>
      </footer>
    </section>
  );
}
