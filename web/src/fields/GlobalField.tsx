import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SRGBColorSpace,
} from "three";
import { formColor } from "../forms/formColor";
import { motionScale, prefersReducedMotion } from "../forms/reducedMotion";
import { latLonToVector3 } from "../geo/latLon";
import { layerRegistry } from "../layers/registry";
import { useTimeline } from "../timeline/TimelineContext";
import {
  DOT_SIZE,
  DOT_SIZE_SPREAD,
  DOT_TREND_DIM_FLOOR,
  FIELD_RADIUS,
  HOT_WHITE,
  MONTH_FOLLOW_RATE,
  TWINKLE_AMOUNT,
  TWINKLE_SPEED,
  WITH_TREND_MAP_STRENGTH,
} from "./fieldConfig";
import { fieldFrame } from "./fieldFrame";
import { seededRandom } from "./fieldGrid";
import {
  blendLevels,
  calendarMonth,
  dotBrightness,
  followMonth,
  monthBlend,
  nearFarBlend,
} from "./fieldMapping";
import { useField, type FieldData } from "./loadField";
import type { TrendMap } from "../trendmap/loadTrendMap";
import { trendDotColors } from "./trendDotColors";

// A soft round glow with a bright core, drawn once.
function glowTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.18, "rgba(255,255,255,0.85)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

type GlobalFieldProps = {
  // Variable of the global trend map; null = off. The dots are part of that
  // map (#197): same variable, same colours.
  id: string | null;
  // The trend map once loaded: each dot takes the colour of its cell.
  trendMap: TrendMap | null;
};

// The glowing dots of the global trend map: dots on a shell just above the
// surface, lit where the monthly climatology of the variable is high and
// coloured by the trend of the cell they sit on.
export function GlobalField({ id, trendMap }: GlobalFieldProps) {
  const timeline = useTimeline();
  const state = useField(id);

  // Off: the place's particles are left exactly as they were.
  useEffect(() => {
    if (state.status !== "ready") fieldFrame.local = 1;
  }, [state.status]);
  useEffect(
    () => () => {
      fieldFrame.local = 1;
    },
    [],
  );

  if (state.status !== "ready") return null;
  return (
    <FieldDotsMesh
      field={state.field}
      month={calendarMonth(timeline.month)}
      speed={timeline.playing ? timeline.speed : 1}
      trendMap={trendMap}
    />
  );
}

function FieldDotsMesh({
  field,
  month,
  speed,
  trendMap,
}: {
  field: FieldData;
  month: number | null;
  speed: number;
  trendMap: TrendMap | null;
}) {
  const shownMonth = useRef<number | null>(null);
  const strength = useRef(0);
  const time = useRef(0);
  const meshRef = useRef<InstancedMesh>(null);
  const layer = layerRegistry.find((item) => item.id === field.variable.id);
  const base = useMemo(
    () => new Color(layer ? formColor(layer) : "#ffffff"),
    [layer],
  );

  const trendColors = useMemo(
    () => trendDotColors(trendMap, field),
    [trendMap, field],
  );

  const mesh = useMemo(() => {
    const { dots } = field;
    const geometry = new PlaneGeometry(1, 1);
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      map: glowTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const instanced = new InstancedMesh(geometry, material, dots.count);
    const random = seededRandom(dots.count + 7);
    const holder = new Object3D();
    for (let dot = 0; dot < dots.count; dot += 1) {
      const point = latLonToVector3(
        dots.lat[dot] ?? 0,
        dots.lon[dot] ?? 0,
        FIELD_RADIUS,
      );
      holder.position.set(point.x, point.y, point.z);
      // Lie flat on the shell: the plane's +Z faces away from the centre.
      holder.lookAt(point.x * 2, point.y * 2, point.z * 2);
      holder.scale.setScalar(
        DOT_SIZE * (1 - DOT_SIZE_SPREAD / 2 + random() * DOT_SIZE_SPREAD),
      );
      holder.updateMatrix();
      instanced.setMatrixAt(dot, holder.matrix);
    }
    instanced.instanceColor = new InstancedBufferAttribute(
      new Float32Array(dots.count * 3),
      3,
    );
    instanced.renderOrder = 3;
    instanced.frustumCulled = false;
    return instanced;
  }, [field]);

  const twinkle = useMemo(() => {
    const random = seededRandom(field.dots.count + 11);
    const count = field.dots.count;
    const rate = new Float32Array(count);
    const phase = new Float32Array(count);
    for (let dot = 0; dot < count; dot += 1) {
      rate[dot] =
        TWINKLE_SPEED[0] + random() * (TWINKLE_SPEED[1] - TWINKLE_SPEED[0]);
      phase[dot] = random() * Math.PI * 2;
    }
    return { rate, phase };
  }, [field]);

  useEffect(
    () => () => {
      mesh.geometry.dispose();
      const material = mesh.material as MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      mesh.dispose();
    },
    [mesh],
  );

  useFrame(({ camera }, delta) => {
    const moving = motionScale();
    time.current += delta * moving;
    const blend = nearFarBlend(camera.position.length());
    fieldFrame.local = blend.local;
    const target = blend.field * (trendColors ? WITH_TREND_MAP_STRENGTH : 1);
    strength.current = prefersReducedMotion()
      ? target
      : strength.current +
        (target - strength.current) * (1 - Math.exp(-4 * delta));

    const goal = month ?? 0;
    shownMonth.current =
      shownMonth.current === null || prefersReducedMotion()
        ? goal
        : followMonth(
            shownMonth.current,
            goal,
            delta * MONTH_FOLLOW_RATE * Math.max(1, speed),
          );
    const { from, to, share } = monthBlend(shownMonth.current);

    const { dots } = field;
    const colors = meshRef.current?.instanceColor;
    if (!colors) return;
    const array = colors.array as Float32Array;
    const amount = strength.current;
    const now = time.current;
    for (let dot = 0; dot < dots.count; dot += 1) {
      const level = blendLevels(
        dots.levels[dot * 12 + from] ?? Number.NaN,
        dots.levels[dot * 12 + to] ?? Number.NaN,
        share,
      );
      let glow = dotBrightness(level, dots.threshold[dot] ?? 1) * amount;
      if (glow > 0 && moving > 0) {
        glow *=
          1 +
          TWINKLE_AMOUNT *
            Math.sin(
              now * (twinkle.rate[dot] ?? 1) + (twinkle.phase[dot] ?? 0),
            );
      }
      const hot = glow > 0 ? HOT_WHITE * level * level : 0;
      let red = base.r;
      let green = base.g;
      let blue = base.b;
      if (trendColors) {
        // Trend colour; the dot is dimmer where the trend is weak or not
        // significant, as the map's own cells are.
        red = trendColors[dot * 4] ?? red;
        green = trendColors[dot * 4 + 1] ?? green;
        blue = trendColors[dot * 4 + 2] ?? blue;
        glow *=
          DOT_TREND_DIM_FLOOR +
          (1 - DOT_TREND_DIM_FLOOR) * (trendColors[dot * 4 + 3] ?? 1);
      }
      array[dot * 3] = glow * (red + (1 - red) * hot);
      array[dot * 3 + 1] = glow * (green + (1 - green) * hot);
      array[dot * 3 + 2] = glow * (blue + (1 - blue) * hot);
    }
    colors.needsUpdate = true;
  });

  return <primitive ref={meshRef} object={mesh} />;
}
