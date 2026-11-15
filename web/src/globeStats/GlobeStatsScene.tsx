import { Html, Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Vector3 } from "three";
import { latLonToVector3 } from "../geo/latLon";
import { css, directionColor, paletteFor, slopeColor } from "./globePalette";
import { robustMax } from "./trendGlyphs";
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
    <Html position={position} center occlude zIndexRange={[0, 0]}>
      <button
        ref={button}
        type="button"
        className={className}
        aria-label={label}
        title={label}
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

function TrendMarks({ state }: { state: GlobeStatsState }) {
  const palette = paletteFor(state.selectedVariableId ?? "");
  return state.trendGlyphs.map((glyph) => {
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
        style={{ color, width: glyph.lengthPx, height: glyph.lengthPx }}
      >
        {glyph.kind === "nodata" ? (
          <span aria-hidden="true">●</span>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 2 22 12h-6v10H8V12H2z"
              transform={glyph.direction < 0 ? "rotate(180 12 12)" : undefined}
              fill={glyph.kind === "solid" ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray={glyph.kind === "unreliable" ? "3 2" : undefined}
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
      />
    );
  });
}

function arcPoints(
  sourceLat: number,
  sourceLon: number,
  targetLat: number,
  targetLon: number,
): Vector3[] {
  const sourceData = latLonToVector3(sourceLat, sourceLon, 1.012);
  const targetData = latLonToVector3(targetLat, targetLon, 1.012);
  const source = new Vector3(sourceData.x, sourceData.y, sourceData.z);
  const target = new Vector3(targetData.x, targetData.y, targetData.z);
  const control = source.clone().add(target);
  if (control.lengthSq() < 1e-8) control.set(0, 1, 0);
  control.normalize().multiplyScalar(1.22);
  return Array.from({ length: 33 }, (_, index) => {
    const amount = index / 32;
    const inverse = 1 - amount;
    return source
      .clone()
      .multiplyScalar(inverse * inverse)
      .addScaledVector(control, 2 * inverse * amount)
      .addScaledVector(target, amount * amount);
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
    const points = arcPoints(
      arc.sourceLat as number,
      arc.sourceLon as number,
      arc.targetLat as number,
      arc.targetLon as number,
    );
    const position = latLonToVector3(
      arc.targetLat as number,
      arc.targetLon as number,
      1.035,
    );
    return (
      <group key={arc.seriesKey}>
        <Line
          points={points}
          color={arc.positive ? "#ffd166" : "#f472b6"}
          lineWidth={arc.widthPx}
          dashed={arc.dashed}
          dashSize={0.035}
          gapSize={0.022}
          transparent
          opacity={0.88}
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
