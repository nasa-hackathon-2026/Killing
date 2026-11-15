// One data companion: an original soft, droplet-like character drawn
// entirely in SVG by this file (no image, font or sound file). It is a
// presentation component: it draws the numbers it is given and fetches
// nothing. What each number changes is in companionData.ts; the table of
// characters is in companionSpec.ts.
import { useId, type CSSProperties, type ReactNode } from "react";
import type { DataKind } from "../analysis/modelVsObs";
import {
  atomPositions,
  elements,
  type MoleculeId,
} from "../chemistry/molecules";
import { trendMark, type TrendSignal } from "../forms/encoding";
import { getVoice, useI18n } from "../i18n";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { companionDrive, moodFor, type CompanionMood } from "./companionData";
import {
  anomalyTint,
  bodyOutline,
  CENTER_X,
  closedSmoothPath,
  detailCount,
  floats,
  GROUND_Y,
  mixHex,
  scatter,
  VIEW_HEIGHT,
  VIEW_HEIGHT_BARE,
  VIEW_WIDTH,
  type BodyBox,
} from "./companionShape";
import {
  companionFor,
  companionTitle,
  companionVariable,
  dataKindShort,
  type CompanionSpec,
} from "./companionSpec";
import "./companions.css";

export type CompanionGesture = "up" | "down";

export type CompanionProps = {
  variableId: string;
  // Normalized reading, 0 = the series' own minimum, 1 = its own maximum
  // (the same number the particle layer gets). null: no data this month.
  value: number | null;
  // Standardized anomaly against the same calendar month; null if unknown.
  anomalyZ?: number | null;
  // Sign of the change per decade: > 0 rising, < 0 falling, 0 or null none.
  trend?: number | null;
  // True only when the trend is significant after the FDR correction.
  significant?: boolean;
  // The full trend signal; when given it replaces `trend` + `significant`
  // and the mark is exactly the layer panel's.
  signal?: TrendSignal;
  // Width in CSS pixels. The height is 1.25 times this with the label and
  // about 1.03 times without it.
  size?: number;
  // Posture override; by default it follows `anomalyZ`.
  mood?: CompanionMood;
  // Draws the small caution mark (the variable has a known problem).
  warning?: boolean;
  // Label under the feet; defaults to the variable's own data kind.
  dataKind?: DataKind;
  showLabel?: boolean;
  // false draws a still figure (also forced by "reduce motion").
  animate?: boolean;
  // Raises an arm to point up or holds a palm down (the Gather layout).
  gesture?: CompanionGesture;
  gestureSide?: "left" | "right";
  className?: string;
};

const INK = "#10202e";
const SOIL_BROWN = "#8a6748";
const MARK_COLOR = "#ffe9a8";
const WARNING_COLOR = "#ffb84d";
const LABEL_COLOR = "#cfd8e6";

function markSignal(
  trend: number | null | undefined,
  significant: boolean | undefined,
): TrendSignal | null {
  if (trend === null || trend === undefined || Number.isNaN(trend)) return null;
  if (!significant || trend === 0)
    return { state: "not-significant", fdr: false };
  return { state: trend > 0 ? "rising" : "falling", fdr: true };
}

// The same marks as the layer panel (▲ ▼ solid only after FDR, △ ▽ before
// FDR only, ◇ not significant), drawn as shapes so no font is needed.
function TrendGlyph({ signal }: { signal: TrendSignal }) {
  const label = trendMark(signal, getVoice()).label;
  const y = 11;
  let shape: ReactNode = null;
  if (signal.state === "rising" || signal.state === "falling") {
    const up = signal.state === "rising";
    const points = up
      ? `${CENTER_X},${y - 7} ${CENTER_X + 7},${y + 5} ${CENTER_X - 7},${y + 5}`
      : `${CENTER_X},${y + 7} ${CENTER_X + 7},${y - 5} ${CENTER_X - 7},${y - 5}`;
    // Not reliable as a climate signal: an outline in the caution colour
    // with a line through it (the layer panel's TrendMarkIcon).
    shape = signal.unreliable ? (
      <>
        <polygon
          points={points}
          fill="none"
          stroke={WARNING_COLOR}
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <line
          x1={CENTER_X - 8.5}
          y1={y + 8}
          x2={CENTER_X + 8.5}
          y2={y - 8}
          stroke={WARNING_COLOR}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </>
    ) : (
      <polygon
        points={points}
        fill={signal.fdr ? MARK_COLOR : "none"}
        stroke={MARK_COLOR}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    );
  } else if (signal.state === "not-significant") {
    shape = (
      <polygon
        points={`${CENTER_X},${y - 7} ${CENTER_X + 6},${y} ${CENTER_X},${y + 7} ${CENTER_X - 6},${y}`}
        fill="none"
        stroke={MARK_COLOR}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    );
  } else if (signal.state === "insufficient") {
    shape = <circle cx={CENTER_X} cy={y} r={2} fill={MARK_COLOR} />;
  }
  if (!shape) return null;
  return (
    <g className="companion-trend">
      <title>{label}</title>
      {/* A hollow mark only takes the pointer on its outline; this square
          makes the tooltip appear anywhere over the mark. */}
      <rect
        className="companion-trend-hit"
        x={CENTER_X - 10}
        y={y - 10}
        width={20}
        height={20}
        fill="transparent"
      />
      {shape}
    </g>
  );
}

type PartProps = {
  spec: CompanionSpec;
  box: BodyBox;
  amount: number;
  seed: number;
};

// Things drawn behind the body.
function Behind({ spec, box, amount }: PartProps) {
  if (spec.kind !== "energy") return null;
  const cy = box.middle - 6;
  if (spec.variant === "land") {
    // Ground heat: wavy lines rising from the head.
    const height = 8 + 10 * amount;
    return (
      <g className="companion-pulse" stroke={spec.baseColor} fill="none">
        {[-16, 0, 16].map((dx) => {
          const x = CENTER_X + dx;
          const y = box.top - 5;
          return (
            <path
              key={dx}
              d={`M${x} ${y}q4 ${-height / 4} 0 ${-height / 2}t0 ${-height / 2}`}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          );
        })}
      </g>
    );
  }
  // Air temperature: short rays around the upper body; longer when the
  // value is higher in its own range.
  const length = 4 + 9 * amount;
  const rays = Array.from({ length: 9 }, (_, index) => {
    const angle = Math.PI * (1.08 - (index / 8) * 1.16);
    const inner = 1.13;
    const x0 = CENTER_X + box.halfWidth * inner * Math.cos(angle);
    const y0 = cy - (box.middle - box.top) * inner * Math.sin(angle);
    return (
      <line
        key={index}
        x1={x0}
        y1={y0}
        x2={x0 + length * Math.cos(angle)}
        y2={y0 - length * Math.sin(angle)}
      />
    );
  });
  return (
    <g
      className="companion-pulse"
      stroke={spec.baseColor}
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      {rays}
    </g>
  );
}

function Molecule({ id, x, y }: { id: MoleculeId; x: number; y: number }) {
  const atoms = atomPositions(id);
  const scale = 10;
  const center = atoms[0];
  if (!center) return null;
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="companion-turn">
        {atoms.slice(1).map((atom, index) => (
          <line
            key={index}
            x1={center.x * scale}
            y1={-center.y * scale}
            x2={atom.x * scale}
            y2={-atom.y * scale}
            stroke="#e8eef7"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        ))}
        {atoms.map((atom, index) => (
          <circle
            key={index}
            cx={atom.x * scale}
            cy={-atom.y * scale}
            r={elements[atom.element].vdwRadius * 3.6}
            fill={elements[atom.element].cpkColor}
            stroke="rgba(8, 14, 28, 0.55)"
            strokeWidth={0.8}
          />
        ))}
      </g>
    </g>
  );
}

// Things drawn inside the body (clipped to its outline).
function Inside({ spec, box, amount, seed }: PartProps) {
  const height = box.bottom - box.top;
  switch (spec.kind) {
    case "water":
      return (
        <path
          d={`M${CENTER_X - 22} ${box.top + height * 0.42}q2 -17 17 -22`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.75}
          strokeWidth={3.2}
          strokeLinecap="round"
        />
      );
    case "gas": {
      const id: MoleculeId = spec.variant === "O3" ? "O3" : "NO2";
      return (
        <>
          <path
            d={`M${CENTER_X - 22} ${box.middle - 6}q3 -14 14 -19`}
            fill="none"
            stroke="#ffffff"
            strokeOpacity={0.55}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <Molecule id={id} x={CENTER_X} y={box.middle + height * 0.2} />
        </>
      );
    }
    case "soil": {
      const half = box.top + height * 0.56;
      const noise = scatter(seed, 60);
      const grains = Array.from({ length: 16 }, (_, index) => ({
        x: CENTER_X + ((noise[index * 3] ?? 0.5) - 0.5) * box.halfWidth * 1.8,
        y: box.top + 8 + (noise[index * 3 + 1] ?? 0.5) * (height - 10),
        r: 0.9 + (noise[index * 3 + 2] ?? 0.5) * 1.3,
      }));
      // Soil water: lenses in the lower half, more of them in wetter months.
      const lenses = detailCount(amount, [1, 6]);
      return (
        <>
          <rect
            x={0}
            y={half}
            width={VIEW_WIDTH}
            height={VIEW_HEIGHT}
            fill="#4f3a28"
            fillOpacity={0.6}
          />
          {grains.map((grain, index) => (
            <circle
              key={index}
              cx={grain.x}
              cy={grain.y}
              r={grain.r}
              fill={index % 2 === 0 ? "#c9a57d" : "#3d2c1e"}
              fillOpacity={0.8}
            />
          ))}
          {Array.from({ length: lenses }, (_, index) => (
            <ellipse
              key={index}
              className="companion-pulse"
              cx={CENTER_X - 25 + index * 10}
              cy={half + 6 + (index % 2) * 7}
              rx={4.6}
              ry={2.2}
              fill={spec.baseColor}
              stroke={spec.accentColor}
              strokeWidth={0.6}
            />
          ))}
        </>
      );
    }
    case "aerosol": {
      const count = detailCount(amount, [5, 16]);
      const noise = scatter(seed, count * 3);
      return (
        <>
          <ellipse
            cx={CENTER_X + 6}
            cy={box.middle + 6}
            rx={box.halfWidth * 0.8}
            ry={height * 0.3}
            fill="#5f5a54"
            fillOpacity={0.45}
          />
          {Array.from({ length: count }, (_, index) => (
            <rect
              key={index}
              x={
                CENTER_X +
                ((noise[index * 3] ?? 0.5) - 0.5) * box.halfWidth * 1.7
              }
              y={box.top + 6 + (noise[index * 3 + 1] ?? 0.5) * (height - 10)}
              width={1.6 + (noise[index * 3 + 2] ?? 0.5) * 3}
              height={1.4 + (noise[index * 3 + 2] ?? 0.5) * 2.4}
              rx={0.6}
              transform={`rotate(${index * 37} ${CENTER_X} ${box.middle})`}
              fill={index % 3 === 0 ? "#4a443d" : spec.accentColor}
              fillOpacity={0.85}
            />
          ))}
        </>
      );
    }
    default:
      return null;
  }
}

function leafPath(length: number): string {
  const half = length * 0.3;
  return `M0 0C${-half} ${-length * 0.35} ${-half * 0.7} ${-length * 0.85} 0 ${-length}C${half * 0.7} ${-length * 0.85} ${half} ${-length * 0.35} 0 0Z`;
}

// Things drawn in front of or around the body.
function Front({ spec, box, amount, seed }: PartProps) {
  switch (spec.kind) {
    case "water": {
      // Falling drops under the body; more of them in wetter months.
      const drops = detailCount(amount, [1, 3]);
      return (
        <g fill={spec.baseColor} fillOpacity={0.9}>
          {Array.from({ length: drops }, (_, index) => (
            <g
              key={index}
              transform={`translate(${CENTER_X + (index - (drops - 1) / 2) * 20} ${box.bottom + 3})`}
            >
              <path
                className="companion-drip"
                style={{ animationDelay: `${index * -0.45}s` }}
                d="M0 0C2.4 3.4 3 4.8 3 6.2A3 3 0 0 1 -3 6.2C-3 4.8 -2.4 3.4 0 0Z"
              />
            </g>
          ))}
        </g>
      );
    }
    case "vapor": {
      const count = detailCount(amount, [2, 7]);
      const noise = scatter(seed, count * 2);
      const rising = spec.variant === "rising";
      return (
        <g fill={spec.baseColor} stroke={spec.accentColor} strokeWidth={0.6}>
          {Array.from({ length: count }, (_, index) => {
            const spread = rising ? box.halfWidth * 0.9 : box.halfWidth * 2.3;
            const x = CENTER_X + ((noise[index * 2] ?? 0.5) - 0.5) * spread;
            const y = rising
              ? box.top - 2 - (noise[index * 2 + 1] ?? 0.5) * 12
              : box.top +
                (noise[index * 2 + 1] ?? 0.5) * (box.bottom - box.top);
            return (
              <circle
                key={index}
                className="companion-rise"
                style={{ animationDelay: `${index * -0.6}s` }}
                cx={x}
                cy={y}
                r={1.8 + (index % 3) * 0.9}
                fillOpacity={0.75}
              />
            );
          })}
        </g>
      );
    }
    case "plant": {
      // Leaves on the head: one at the lowest NDVI of the record, five at
      // the highest, and greener as the value goes up.
      const leaves = detailCount(amount, [1, 5]);
      const fill = mixHex(
        spec.accentColor,
        spec.baseColor,
        0.25 + 0.75 * amount,
      );
      return (
        <g transform={`translate(${CENTER_X} ${box.top + 3})`}>
          {Array.from({ length: leaves }, (_, index) => {
            const angle = leaves === 1 ? 0 : -52 + (index / (leaves - 1)) * 104;
            const length = 20 - Math.abs(angle) * 0.07;
            return (
              <g key={index} transform={`rotate(${angle})`}>
                <g
                  className="companion-sway"
                  style={{ animationDelay: `${index * -0.3}s` }}
                >
                  <path
                    d={leafPath(length)}
                    fill={fill}
                    stroke="#1d6b3a"
                    strokeWidth={1}
                    strokeLinejoin="round"
                  />
                  <line
                    x1={0}
                    y1={-2}
                    x2={0}
                    y2={-length + 4}
                    stroke="#1d6b3a"
                    strokeWidth={0.8}
                  />
                </g>
              </g>
            );
          })}
        </g>
      );
    }
    case "aerosol": {
      const count = detailCount(amount, [2, 6]);
      const noise = scatter(seed + 7, count * 2);
      return (
        <g fill={spec.baseColor}>
          {Array.from({ length: count }, (_, index) => (
            <rect
              key={index}
              className="companion-rise"
              style={{ animationDelay: `${index * -0.7}s` }}
              x={
                CENTER_X +
                (index % 2 === 0 ? -1 : 1) *
                  (box.halfWidth + 3 + (noise[index * 2] ?? 0.5) * 9)
              }
              y={box.top + 8 + (noise[index * 2 + 1] ?? 0.5) * 36}
              width={2 + (index % 3)}
              height={1.8 + (index % 2)}
              rx={0.6}
            />
          ))}
        </g>
      );
    }
    default:
      return null;
  }
}

function Arm({
  box,
  gesture,
  side,
  color,
}: {
  box: BodyBox;
  gesture: CompanionGesture;
  side: "left" | "right";
  color: string;
}) {
  const sign = side === "right" ? 1 : -1;
  const x0 = CENTER_X + sign * box.halfWidth * 0.82;
  const y0 = box.middle - 4;
  const [x1, y1] =
    gesture === "up"
      ? [CENTER_X + sign * (box.halfWidth + 9), box.top - 6]
      : [CENTER_X + sign * (box.halfWidth + 15), box.middle + 4];
  return (
    <g>
      <line
        x1={x0}
        y1={y0}
        x2={x1}
        y2={y1}
        stroke={color}
        strokeWidth={6.5}
        strokeLinecap="round"
      />
      {gesture === "up" ? (
        <circle cx={x1} cy={y1 - 2} r={4.4} fill={color} />
      ) : (
        <ellipse cx={x1 + sign * 2} cy={y1 + 2} rx={7} ry={3} fill={color} />
      )}
    </g>
  );
}

function hashSeed(text: string): number {
  let hash = 7;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function Companion({
  variableId,
  value,
  anomalyZ = null,
  trend,
  significant,
  signal,
  size = 96,
  mood,
  warning = false,
  dataKind,
  showLabel = true,
  animate = true,
  gesture,
  gestureSide = "right",
  className,
}: CompanionProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { t } = useI18n();
  const spec = companionFor(variableId);
  if (!spec) return null;
  const hasData = value !== null && !Number.isNaN(value);
  const drive = companionDrive(variableId, value);
  const posture = mood ?? moodFor(anomalyZ);
  const moving = animate && !prefersReducedMotion();
  const box = bodyOutline(spec, posture, 0);
  const rest = closedSmoothPath(box.points);
  const breathed = closedSmoothPath(bodyOutline(spec, posture, 1).points);
  const shown = signal ?? markSignal(trend, significant);
  const kind = dataKind ?? spec.dataKind;
  const seed = hashSeed(variableId);
  const part: PartProps = { spec, box, amount: drive.amount, seed };

  let fill = spec.baseColor;
  let fillOpacity = 0.9;
  let stroke = mixHex(spec.baseColor, INK, 0.35);
  if (spec.kind === "energy") {
    fill = anomalyTint(anomalyZ, spec.baseColor);
    stroke = mixHex(fill, INK, 0.4);
  } else if (spec.kind === "water") {
    fillOpacity = 0.62;
  } else if (spec.kind === "vapor") {
    fillOpacity = 0.55;
  } else if (spec.kind === "gas") {
    fill = mixHex(spec.baseColor, "#ffffff", 0.35);
    fillOpacity = 0.5;
    stroke = spec.baseColor;
  } else if (spec.kind === "soil") {
    fill = SOIL_BROWN;
    stroke = "#3d2c1e";
  } else if (spec.kind === "plant") {
    fill = mixHex(spec.accentColor, spec.baseColor, 0.45 + 0.55 * drive.amount);
  } else if (spec.kind === "aerosol") {
    fillOpacity = 0.82;
  }

  const eyeY = spec.kind === "gas" ? box.middle - 11 : box.middle - 5;
  const eyeGap = 10.5;
  const grounded = !floats(spec);
  const label = [spec.tag, dataKindShort(kind)].filter(Boolean).join(" · ");
  const viewHeight = showLabel ? VIEW_HEIGHT : VIEW_HEIGHT_BARE;
  const style = {
    "--companion-period": `${drive.period.toFixed(2)}s`,
  } as CSSProperties;
  const title = t(
    hasData ? "companions.figureTitle" : "companions.figureTitleNoData",
    { name: companionTitle(spec), variable: companionVariable(spec) },
  );

  return (
    <svg
      className={[
        "companion",
        `companion-kind-${spec.kind}`,
        moving ? "companion-moving" : "",
        hasData ? "" : "companion-empty",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
      width={size}
      height={(size * viewHeight) / VIEW_WIDTH}
      role="img"
      aria-label={title}
      data-companion={spec.id}
      data-mood={posture}
      style={style}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={`${uid}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.5} />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.18} />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d={rest} />
        </clipPath>
        <filter id={`${uid}-soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      {shown ? <TrendGlyph signal={shown} /> : null}
      <ellipse
        cx={CENTER_X}
        cy={GROUND_Y + 3}
        rx={grounded ? 34 : 22}
        ry={grounded ? 3.2 : 2.2}
        fill="#000000"
        fillOpacity={grounded ? 0.32 : 0.2}
      />
      {spec.kind === "vapor" && spec.variant === "rising" ? (
        <path
          d={`M${CENTER_X - 42} ${GROUND_Y + 3}q7 -4 14 0t14 0t14 0t14 0t14 0t14 0`}
          fill="none"
          stroke={spec.baseColor}
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      ) : null}
      {spec.variant === "land" ? (
        <path
          d={`M${CENTER_X - 42} ${GROUND_Y + 3}h84`}
          stroke={spec.baseColor}
          strokeWidth={2}
          strokeDasharray="5 3"
        />
      ) : null}
      <g
        opacity={hasData ? 1 : 0.4}
        transform={`translate(${CENTER_X} ${GROUND_Y}) scale(${drive.scale.toFixed(3)}) translate(${-CENTER_X} ${-GROUND_Y})`}
      >
        <g className={grounded ? "companion-breathe" : "companion-float"}>
          <Behind {...part} />
          {gesture ? (
            <Arm
              box={box}
              gesture={gesture}
              side={gestureSide}
              color={stroke}
            />
          ) : null}
          {spec.kind === "vapor" ? (
            <path
              d={rest}
              fill={spec.baseColor}
              fillOpacity={0.5}
              filter={`url(#${uid}-soft)`}
            />
          ) : null}
          <path
            d={rest}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={spec.kind === "vapor" ? 0.8 : 1.8}
            strokeDasharray={hasData ? undefined : "4 3"}
            strokeLinejoin="round"
          >
            {moving ? (
              <animate
                attributeName="d"
                dur={`${(drive.period * 1.7).toFixed(2)}s`}
                repeatCount="indefinite"
                values={`${rest};${breathed};${rest}`}
                calcMode="spline"
                keyTimes="0;0.5;1"
                keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
              />
            ) : null}
          </path>
          <g clipPath={`url(#${uid}-clip)`}>
            <Inside {...part} />
            <path d={rest} fill={`url(#${uid}-shade)`} />
          </g>
          {hasData ? (
            <g fill={INK}>
              <ellipse cx={CENTER_X - eyeGap} cy={eyeY} rx={2.9} ry={4.1} />
              <ellipse cx={CENTER_X + eyeGap} cy={eyeY} rx={2.9} ry={4.1} />
              <circle
                cx={CENTER_X - eyeGap - 0.9}
                cy={eyeY - 1.5}
                r={0.9}
                fill="#ffffff"
              />
              <circle
                cx={CENTER_X + eyeGap - 0.9}
                cy={eyeY - 1.5}
                r={0.9}
                fill="#ffffff"
              />
            </g>
          ) : (
            <g stroke={INK} strokeWidth={2} strokeLinecap="round">
              <line
                x1={CENTER_X - eyeGap - 3}
                y1={eyeY}
                x2={CENTER_X - eyeGap + 3}
                y2={eyeY}
              />
              <line
                x1={CENTER_X + eyeGap - 3}
                y1={eyeY}
                x2={CENTER_X + eyeGap + 3}
                y2={eyeY}
              />
            </g>
          )}
          {hasData ? <Front {...part} /> : null}
        </g>
      </g>
      {warning ? (
        <g className="companion-warning">
          <title>{t("companions.cautionTitle")}</title>
          <path
            d="M104 8l9 16h-18z"
            fill={WARNING_COLOR}
            stroke="#3a2a08"
            strokeWidth={1}
            strokeLinejoin="round"
          />
          <rect x={103.2} y={13} width={1.6} height={6} fill="#3a2a08" />
          <rect x={103.2} y={20.2} width={1.6} height={1.6} fill="#3a2a08" />
        </g>
      ) : null}
      {showLabel ? (
        <text
          className="companion-label"
          x={CENTER_X}
          y={VIEW_HEIGHT - 12}
          textAnchor="middle"
          fill={LABEL_COLOR}
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
