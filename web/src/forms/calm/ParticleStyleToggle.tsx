import "./calm.css";
import { useI18n } from "../../i18n";
import { calmText } from "./calmText";
import {
  setParticleStyle,
  useParticleStyle,
  type ParticleStyle,
} from "./particleStyle";

function styles(): { id: ParticleStyle; label: string; title: string }[] {
  return [
    { id: "calm", label: calmText.styleCalm, title: calmText.styleCalmTitle },
    {
      id: "lively",
      label: calmText.styleLively,
      title: calmText.styleLivelyTitle,
    },
  ];
}

// Five overlapping dots: the picture of "five units combined".
const CLUMP = [0, 1, 2, 3, 4].map((k) => {
  const angle = Math.PI / 2 + (k * 2 * Math.PI) / 5;
  return { x: 3.4 * Math.cos(angle), y: -3.4 * Math.sin(angle) };
});

// The "Particles: Calm / Lively" switch at the top of the Layers panel, and
// under it a one-line legend of the Calm style.
export function ParticleStyleToggle() {
  useI18n();
  const style = useParticleStyle();
  return (
    <div className="calm-toggle">
      <div role="group" aria-label={calmText.toggleGroupAria}>
        <span>{calmText.toggleLabel}</span>
        {styles().map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.title}
            aria-pressed={style === item.id}
            onClick={() => setParticleStyle(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {style === "calm" ? (
        <>
          <ul className="calm-legend" aria-label={calmText.legendAria}>
            <li>
              <svg viewBox="-9 -9 18 18" aria-hidden="true">
                <circle r="3" className="calm-legend-fill" />
              </svg>
              {calmText.legendUnit}
            </li>
            <li>
              <svg viewBox="-9 -9 18 18" aria-hidden="true">
                <circle r="8" className="calm-legend-badge" />
                {CLUMP.map((dot, index) => (
                  <circle
                    key={index}
                    cx={dot.x}
                    cy={dot.y}
                    r="3"
                    className="calm-legend-fill"
                  />
                ))}
              </svg>
              {calmText.legendGroup}
            </li>
            <li>
              <svg viewBox="-9 -9 18 18" aria-hidden="true">
                <circle r="7.5" className="calm-legend-halo" />
              </svg>
              {calmText.legendDisc}
            </li>
            <li>
              <svg viewBox="-9 -9 18 18" aria-hidden="true">
                <circle r="7" className="calm-legend-ring" />
              </svg>
              {calmText.legendRing}
            </li>
            <li>
              <svg viewBox="-9 -9 18 18" aria-hidden="true">
                <circle r="7" className="calm-legend-ring calm-legend-dashed" />
              </svg>
              {calmText.legendNoData}
            </li>
            <li>
              <svg viewBox="-9 -9 18 18" aria-hidden="true">
                <path d="M0 -7 L6 5 L-6 5 Z" className="calm-legend-fill" />
              </svg>
              {calmText.legendArrow}
            </li>
          </ul>
          <p className="calm-legend-note">{calmText.legendScale}</p>
        </>
      ) : null}
    </div>
  );
}
