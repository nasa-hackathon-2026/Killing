import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";
import { latLonToVector3 } from "../geo/latLon";
import { greatCircleArcPoints } from "./greatCircleArc";
import { css, directionColor, paletteFor, slopeColor } from "./globePalette";
import {
  minSeparationDeg,
  OUTLINE_STROKE_PX,
  robustMax,
  spreadMarks,
} from "./trendGlyphs";
import type { GlobeStatsState } from "./useGlobeStats";
import "./globeStats.css";

function FrontFacingButton({
  position,
  lat,
  lon,
  className,
  label,
  children,
  onClick,
  style,
}: {
  position: [number, number, number];
  lat: number;
  lon: number;
  className: string;
  label: string;
  children?: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const normal = useMemo(() => {
    const coordinates = latLonToVector3(lat, lon);
    return new Vector3(coordinates.x, coordinates.y, coordinates.z).normalize();
  }, [lat, lon]);
  useFrame(({ camera }) => {
    if (button.current) {
      button.current.style.visibility =
        normal.dot(camera.position) > 1.02 ? "visible" : "hidden";
    }
  });

  return (
    <Html position={position} center zIndexRange={[0, 0]}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        title={label}
        // Out of the Tab order: "Show as table" lists the same places, and
        // the keyboard reaches the HUD first.
        tabIndex={-1}
        style={style}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
      >
        {children}
      </button>
    </Html>
  );
}

// The minimum separation between marks for the current camera distance,
// rounded so the marks are recomputed only when it changes noticeably.
function useMinSeparation(): number {
  const [minDeg, setMinDeg] = useState(() => minSeparationDeg(3.2));
  useFrame(({ camera }) => {
    const next = Math.round(minSeparationDeg(camera.position.length()) * 4) / 4;
    if (next !== minDeg) setMinDeg(next);
  });
  return minDeg;
}

function TrendMarks({ state }: { state: GlobeStatsState }) {
  const palette = paletteFor(state.selectedVariableId ?? "");
  const minDeg = useMinSeparation();
  // Far away, places close together (the Taiwan points) share one mark:
  // the selected place's. The others appear when the camera comes closer.
  const shown = spreadMarks(
    state.trendGlyphs,
    state.selectedLocationId,
    minDeg,
  );
  return shown.map((glyph) => {
    const color = css(directionColor(palette, glyph.direction));
    const position = latLonToVector3(glyph.lat, glyph.lon, 1.025);
    return (
      <FrontFacingButton
        key={glyph.placeId}
        position={[position.x, position.y, position.z]}
        lat={glyph.lat}
        lon={glyph.lon}
        className={`globe-stats-marker globe-trend-marker globe-trend-${glyph.kind}`}
        label={glyph.summary}
        onClick={() => state.onSelectLocation(glyph.placeId)}
        style={{
          color: glyph.kind === "nodata" ? "#8b96a5" : color,
          width: glyph.lengthPx,
          height: glyph.lengthPx,
          opacity: glyph.kind === "unreliable" ? 0.62 : 1,
        }}
      >
        {glyph.kind === "nodata" ? (
          <span aria-hidden="true">●</span>
        ) : glyph.kind === "unreliable" ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3 22 21H2Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="3 2"
            />
            <path
              d="M3 22 21 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 2 22 12h-6v10H8V12H2z"
              transform={glyph.direction < 0 ? "rotate(180 12 12)" : undefined}
              fill={glyph.kind === "solid" ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth={glyph.kind === "solid" ? 2 : OUTLINE_STROKE_PX}
              vectorEffect={
                glyph.kind === "solid" ? undefined : "non-scaling-stroke"
              }
              strokeLinejoin="round"
            />
          </svg>
        )}
      </FrontFacingButton>
    );
  });
}

function GapMarks({ state }: { state: GlobeStatsState }) {
  const palette = paletteFor(state.modelVariableId);
  const limit = robustMax(
    state.gapGlyphs.flatMap((glyph) => [
      glyph.modelSlope,
      glyph.observationSlope,
    ]),
  );
  return state.gapGlyphs.map((glyph) => {
    if (glyph.lat === null || glyph.lon === null) return null;
    const modelColor = css(slopeColor(glyph.modelSlope, limit, palette));
    const observationColor = css(
      slopeColor(glyph.observationSlope, limit, palette),
    );
    const position = latLonToVector3(glyph.lat, glyph.lon, 1.03);
    const issueClasses = [
      glyph.modelUnreliable ? "globe-gap-model-warning" : "",
      glyph.observationUnreliable ? "globe-gap-observation-warning" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <FrontFacingButton
        key={glyph.pairId}
        position={[position.x, position.y, position.z]}
        lat={glyph.lat}
        lon={glyph.lon}
        className={`globe-stats-marker globe-gap-marker ${issueClasses}`}
        label={glyph.summary}
        onClick={() => state.onSelectLocation(glyph.placeId)}
        style={
          {
            background: `linear-gradient(90deg, ${modelColor} 50%, ${observationColor} 50%)`,
            "--globe-gap-ring": `${glyph.ringWidthPx}px`,
          } as React.CSSProperties
        }
      >
        {glyph.modelUnreliable || glyph.observationUnreliable ? (
          <svg
            className="globe-gap-unreliable"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M12 3 22 21H2Z"
              fill="#101a2b"
              stroke="#ffd166"
              strokeWidth="2"
            />
            <path d="M3 22 21 4" stroke="#ffd166" strokeWidth="2" />
          </svg>
        ) : null}
      </FrontFacingButton>
    );
  });
}

function ArcStroke({
  points,
  color,
  width,
  dashed,
}: {
  points: Vector3[];
  color: string;
  width: number;
  dashed: boolean;
}) {
  return points.slice(1).map((end, index) => {
    if (dashed && index % 2 === 1) return null;
    const start = points[index];
    if (!start) return null;
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length < 1e-8) return null;
    const position = start.clone().add(end).multiplyScalar(0.5);
    const quaternion = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      direction.normalize(),
    );
    return (
      <mesh key={index} position={position} quaternion={quaternion}>
        <cylinderGeometry args={[width * 0.001, width * 0.001, length, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.88} />
      </mesh>
    );
  });
}

function AlikeMarks({ state }: { state: GlobeStatsState }) {
  const drawn = state.alikeArcs.filter(
    (arc) =>
      arc.draw &&
      arc.sourceLat !== null &&
      arc.sourceLon !== null &&
      arc.targetLat !== null &&
      arc.targetLon !== null,
  );
  return drawn.map((arc) => {
    const points = greatCircleArcPoints(
      arc.sourceLat as number,
      arc.sourceLon as number,
      arc.targetLat as number,
      arc.targetLon as number,
    ).map((point) => new Vector3(point.x, point.y, point.z));
    const position = latLonToVector3(
      arc.targetLat as number,
      arc.targetLon as number,
      1.035,
    );
    return (
      <group key={arc.seriesKey}>
        <ArcStroke
          points={points}
          color={arc.positive ? "#ffd166" : "#f472b6"}
          width={arc.widthPx}
          dashed={arc.dashed}
        />
        <FrontFacingButton
          position={[position.x, position.y, position.z]}
          lat={arc.targetLat as number}
          lon={arc.targetLon as number}
          className="globe-stats-marker globe-alike-marker"
          label={arc.summary}
          onClick={() => state.onSelectLocation(arc.targetLocationId)}
        />
      </group>
    );
  });
}

export function GlobeStatsScene({ state }: { state: GlobeStatsState }) {
  if (state.hidden || state.mode === "none") return null;
  if (state.mode === "trend") return <TrendMarks state={state} />;
  if (state.mode === "gap") return <GapMarks state={state} />;
  return <AlikeMarks state={state} />;
}
