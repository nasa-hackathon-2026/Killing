// What the layer view's own canvas draws: the platforms, the particles and
// the camera. Labels and companions are HTML over the canvas; this scene
// places them every frame (see `anchors`).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Group,
  type MeshStandardMaterial,
  type PerspectiveCamera,
  type Texture,
} from "three";
import { formSpec } from "../forms/formMapping";
import { layerParticleCap, MAX_FORM_PARTICLES } from "../forms/particleField";
import { motionScale, prefersReducedMotion } from "../forms/reducedMotion";
import { layerRegistry } from "../layers/registry";
import {
  clampDepression,
  clampZoom,
  entryPose,
  entrySpread,
  ENTRY_SECONDS,
  fitDistance,
  FOCUS_ZOOM,
  posePosition,
  HUD_RESERVE,
  insetView,
  labelCeiling,
  viewInsets,
  zoomTargetY,
} from "./strataCamera";
import {
  companionRowXs,
  layoutStrata,
  PLATFORM_DEPTH,
  PLATFORM_WIDTH,
  stackExtent,
  platformCompanionScale,
  stackLabelTops,
  type CompanionPlacement,
  type StratumBox,
} from "./strataLayout";
import { StrataParticles } from "./StrataParticles";
import { strata, strataAssignments, type StratumId } from "./strataSpec";
import type { SurfaceImage } from "./surfaceCrop";

// What the user's drag and wheel have set; written by StrataView.
export type StrataOrbit = {
  azimuth: number;
  depression: number;
  zoom: number;
  // 0 = top of the view, 1 = bottom: where the pointer was at the last wheel.
  pointerFraction: number;
};

// An HTML element the scene places every frame.
export type StrataAnchor = {
  key: string;
  stratum: StratumId;
  // "label": only the height is used (the element stays in the left column).
  // "spot": a point at the height of the platform, [x, z].
  spot: [number, number] | null;
};

// Rows of companions beside the stack, in pixels.
// Between two companions of one row.
const ROW_GAP = 6;
// Between the platform's rightmost corner and the row.
const ROW_EDGE = 14;
// Kept clear left of the Layers panel (or the docked chart).
const ROW_MARGIN = 10;
// The first row starts this far below the folded Companions chip.
const ROW_BELOW_CHIP = 8;

export type SceneLayer = {
  id: string;
  visible: boolean;
  opacity: number;
  value: number;
  hasData: boolean;
};

type StrataSceneProps = {
  layers: SceneLayer[];
  selected: StratumId | null;
  closing: boolean;
  orbit: RefObject<StrataOrbit>;
  anchors: StrataAnchor[];
  elements: RefObject<Map<string, Element>>;
  surface: SurfaceImage;
  // Companions in a row right of the stack, or on their platforms
  // (strataCamera.ts companionPlacement).
  placement: CompanionPlacement;
  // True while the time series chart is open: on a wide screen it is docked
  // beside the Layers panel and the stack moves over (strataCamera.ts).
  chartOpen: boolean;
  onSelect: (id: StratumId | null) => void;
  onClosed: () => void;
};

const CORNER = 0.14;

function plateGeometry(): BufferGeometry {
  const w = PLATFORM_WIDTH / 2;
  const d = PLATFORM_DEPTH / 2;
  const shape = new Shape();
  shape.moveTo(-w + CORNER, -d);
  shape.lineTo(w - CORNER, -d);
  shape.quadraticCurveTo(w, -d, w, -d + CORNER);
  shape.lineTo(w, d - CORNER);
  shape.quadraticCurveTo(w, d, w - CORNER, d);
  shape.lineTo(-w + CORNER, d);
  shape.quadraticCurveTo(-w, d, -w, d - CORNER);
  shape.lineTo(-w, -d + CORNER);
  shape.quadraticCurveTo(-w, -d, -w + CORNER, -d);
  const geometry = new ShapeGeometry(shape, 6);
  const position = geometry.getAttribute("position");
  const uv: number[] = [];
  for (let index = 0; index < position.count; index += 1) {
    uv.push(
      position.getX(index) / PLATFORM_WIDTH + 0.5,
      position.getY(index) / PLATFORM_DEPTH + 0.5,
    );
  }
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  // Lie flat: the shape's +y becomes -z (north, away from the first view).
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function outlineGeometry(plate: BufferGeometry): BufferGeometry {
  // The plate's outer loop: ShapeGeometry lists the contour points first.
  const position = plate.getAttribute("position");
  const points: Vector3[] = [];
  const contour = position.count;
  for (let index = 0; index < contour; index += 1) {
    points.push(
      new Vector3(
        position.getX(index),
        position.getY(index),
        position.getZ(index),
      ),
    );
  }
  return new BufferGeometry().setFromPoints(points);
}

function useSurfaceTexture(surface: SurfaceImage): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let alive = true;
    let loaded: Texture | null = null;
    const loader = new TextureLoader();
    loader.setCrossOrigin("anonymous");
    const url = surface.file.startsWith("http")
      ? surface.file
      : `${import.meta.env.BASE_URL}${surface.file}`;
    loader.load(url, (map) => {
      loaded = map;
      if (!alive) {
        map.dispose();
        return;
      }
      map.colorSpace = SRGBColorSpace;
      map.offset.set(surface.offset[0], surface.offset[1]);
      map.repeat.set(surface.repeat[0], surface.repeat[1]);
      setTexture(map);
    });
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, [surface]);
  return texture;
}

export function StrataScene({
  layers,
  selected,
  closing,
  orbit,
  anchors,
  elements,
  surface,
  chartOpen,
  placement,
  onSelect,
  onClosed,
}: StrataSceneProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const size = useThree((state) => state.size);
  const plate = useMemo(() => plateGeometry(), []);
  const outline = useMemo(() => outlineGeometry(plate), [plate]);
  const texture = useSurfaceTexture(surface);
  const groups = useRef<(Group | null)[]>([]);
  const plates = useRef<(MeshStandardMaterial | null)[]>([]);
  const boxes = useRef<StratumBox[]>(layoutStrata(0));
  const time = useRef(0);
  const progress = useRef(prefersReducedMotion() ? 1 : 0);
  const closed = useRef(false);
  const smooth = useRef({ zoom: 1, targetY: 0, ready: false });
  const projected = useRef(new Vector3());
  useEffect(
    () => () => {
      plate.dispose();
      outline.dispose();
    },
    [plate, outline],
  );

  // The HUD, the legend and (on a narrow screen) the labels and the layer
  // panel take part of the screen; the picture is fitted into the rest.
  const view = useMemo(
    () =>
      insetView(
        size.width,
        size.height,
        viewInsets(size.width, size.height, chartOpen, placement),
      ),
    [size.width, size.height, chartOpen, placement],
  );
  useEffect(() => {
    camera.setViewOffset(
      size.width,
      size.height,
      -view.offsetX,
      -view.offsetY,
      size.width,
      size.height,
    );
    return () => camera.clearViewOffset();
  }, [camera, size.width, size.height, view]);

  const openLayers = layers.filter((layer) => layer.visible).length;

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.25);
    time.current += step * motionScale();
    if (prefersReducedMotion()) {
      progress.current = closing ? 0 : 1;
    } else {
      const direction = closing ? -1 : 1;
      progress.current = Math.min(
        1,
        Math.max(0, progress.current + (direction * step) / ENTRY_SECONDS),
      );
    }
    if (closing && progress.current <= 0 && !closed.current) {
      closed.current = true;
      onClosed();
    }
    const t = progress.current;
    const layout = layoutStrata(entrySpread(t));
    boxes.current = layout;
    const extent = stackExtent(layout);
    const user = orbit.current;
    const chosen = selected
      ? layout.find((box) => box.id === selected)
      : undefined;
    const wantZoom = chosen
      ? Math.min(clampZoom(user.zoom), FOCUS_ZOOM)
      : clampZoom(user.zoom);
    const wantY = chosen
      ? (chosen.y + chosen.top) / 2
      : zoomTargetY(wantZoom, user.pointerFraction, extent.bottom, extent.top);
    const state = smooth.current;
    if (!state.ready || prefersReducedMotion()) {
      state.zoom = wantZoom;
      state.targetY = wantY;
      state.ready = true;
    } else {
      const ease = 1 - Math.exp(-6 * step);
      state.zoom += (wantZoom - state.zoom) * ease;
      state.targetY += (wantY - state.targetY) * ease;
    }
    const pose = entryPose(t, {
      azimuth: user.azimuth,
      depression: clampDepression(user.depression),
      distance: fitDistance(view.aspect) * view.scale * state.zoom,
      targetY: state.targetY,
    });
    const [x, y, z] = posePosition(pose);
    camera.position.set(x, y, z);
    camera.lookAt(0, pose.targetY, 0);
    camera.updateMatrixWorld();

    layout.forEach((box, index) => {
      const group = groups.current[index];
      if (group) group.position.y = box.y;
      const material = plates.current[index];
      if (material) {
        const base = box.id === "land-surface" && texture ? 0.92 : 0.2;
        const dim = selected && selected !== box.id ? 0.35 : 1;
        material.opacity += (base * dim - material.opacity) * 0.2;
      }
    });

    // The labels stay in the left column at the height of their stratum,
    // but never under the legend, on top of each other, or over the credit
    // and the timeline bar. Companions stand on their platform, or (beside)
    // in one row per stratum right of the stack, kept the same way: at the
    // height of their stratum, apart, below the companion chip, above the
    // timeline bar and left of the Layers panel. Every read of the page
    // comes first; the writes are queued and applied at the end, so a frame
    // lays the page out once.
    const writes: (() => void)[] = [];
    const html = (key: string) => {
      const element = elements.current?.get(key);
      return element instanceof HTMLElement ? element : undefined;
    };
    const header = html("header");
    const floor = header ? header.offsetTop + header.offsetHeight + 6 : 0;
    const labels: { element: HTMLElement; center: number; height: number }[] =
      [];
    const rows = new Map<
      StratumId,
      {
        // The middle of the platform's right edge (where the line starts)
        // and the rightmost of its corners on screen (the row starts right
        // of it, whatever way the stack is turned).
        edge: [number, number];
        right: number;
        items: { element: HTMLElement; x: number; width: number }[];
      }
    >();
    // Companions standing on the platforms: placed after the loop, once all
    // positions are known (platformCompanionScale).
    const feet: {
      element: HTMLElement;
      x: number;
      y: number;
      visible: boolean;
    }[] = [];
    const toScreen = (x: number, y: number, z: number) => {
      const point = projected.current;
      point.set(x, y, z).project(camera);
      return {
        x: (point.x * 0.5 + 0.5) * size.width,
        y: (-point.y * 0.5 + 0.5) * size.height,
        visible: point.z < 1,
      };
    };
    for (const anchor of anchors) {
      const element = html(anchor.key);
      const box = layout.find((item) => item.id === anchor.stratum);
      if (!element || !box) continue;
      const at = anchor.spot
        ? toScreen(anchor.spot[0], box.y, anchor.spot[1])
        : toScreen(0, (box.y + box.top) / 2, 0);
      const visibility = at.visible ? "visible" : "hidden";
      writes.push(() => {
        element.style.visibility = visibility;
      });
      if (!anchor.spot) {
        labels.push({ element, center: at.y, height: element.offsetHeight });
        continue;
      }
      if (placement === "on") {
        feet.push({ element, x: at.x, y: at.y, visible: at.visible });
        continue;
      }
      let row = rows.get(anchor.stratum);
      if (!row) {
        const edge = toScreen(PLATFORM_WIDTH / 2, box.y, 0);
        let right = edge.x;
        for (const sx of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const corner = toScreen(
              (sx * PLATFORM_WIDTH) / 2,
              box.y,
              (sz * PLATFORM_DEPTH) / 2,
            );
            right = Math.max(right, corner.x);
          }
        }
        row = { edge: [edge.x, edge.y], right, items: [] };
        rows.set(anchor.stratum, row);
      }
      row.items.push({ element, x: at.x, width: element.offsetWidth });
    }
    if (feet.length > 0) {
      const scale = platformCompanionScale(feet);
      for (const foot of feet) {
        const transform = `translate(${foot.x.toFixed(1)}px, ${foot.y.toFixed(1)}px) translate(-50%, -100%) scale(${(scale ?? 1).toFixed(3)})`;
        const hidden = scale === null || !foot.visible;
        writes.push(() => {
          foot.element.style.transform = transform;
          foot.element.style.visibility = hidden ? "hidden" : "visible";
        });
      }
    }
    const tops = stackLabelTops(
      labels.map((label) => label.center),
      labels.map((label) => label.height),
      floor,
      labelCeiling(size.width, size.height),
    );
    labels.forEach((label, index) => {
      const transform = `translate(0, ${(tops[index] ?? 0).toFixed(1)}px)`;
      writes.push(() => {
        label.element.style.transform = transform;
      });
    });

    if (placement === "beside") {
      const ordered = strata.flatMap((item) => {
        const row = rows.get(item.id);
        return row ? [{ id: item.id, row }] : [];
      });
      const chip = document.querySelector(".companion-dock");
      const rowFloor = Math.max(
        HUD_RESERVE,
        chip ? chip.getBoundingClientRect().bottom + ROW_BELOW_CHIP : 0,
      );
      const base = viewInsets(size.width, size.height, chartOpen);
      const rowCeiling = size.height - base.bottom;
      const rowRight = size.width - base.right - ROW_MARGIN;
      const heights = ordered.map(({ row }) =>
        Math.max(...row.items.map((item) => item.element.offsetHeight)),
      );
      // Each row is placed so the middle of the figures (not of the figure
      // and its caption) is at the height of the platform.
      const figureMiddles = ordered.map(({ row }) => {
        const figure = row.items[0]?.element.querySelector("svg");
        return figure instanceof SVGElement
          ? figure.getBoundingClientRect().height / 2
          : (row.items[0]?.element.offsetHeight ?? 0) / 2;
      });
      const rowTops = stackLabelTops(
        ordered.map(
          ({ row }, index) =>
            row.edge[1] -
            (figureMiddles[index] ?? 0) +
            (heights[index] ?? 0) / 2,
        ),
        heights,
        rowFloor,
        rowCeiling,
      );
      const linked = new Set<StratumId>();
      ordered.forEach(({ id, row }, index) => {
        const top = rowTops[index] ?? 0;
        const width = Math.max(...row.items.map((item) => item.width));
        const xs = companionRowXs(
          row.items.map((item) => item.x),
          width,
          ROW_GAP,
          row.right + ROW_EDGE,
          rowRight,
        );
        row.items.forEach((item, at) => {
          const transform = `translate(${((xs[at] ?? 0) - item.width / 2).toFixed(1)}px, ${top.toFixed(1)}px)`;
          writes.push(() => {
            item.element.style.transform = transform;
          });
        });
        const link = elements.current?.get(`link:${id}`);
        if (!link) return;
        linked.add(id);
        const ends = {
          x1: row.edge[0].toFixed(1),
          y1: row.edge[1].toFixed(1),
          x2: ((xs[0] ?? 0) - width / 2).toFixed(1),
          y2: (top + (figureMiddles[index] ?? 0)).toFixed(1),
        };
        writes.push(() => {
          for (const [name, value] of Object.entries(ends)) {
            link.setAttribute(name, value);
          }
          link.setAttribute("visibility", "visible");
        });
      });
      for (const item of strata) {
        const link = elements.current?.get(`link:${item.id}`);
        if (link && !linked.has(item.id)) {
          writes.push(() => link.setAttribute("visibility", "hidden"));
        }
      }
    }
    for (const write of writes) write();
  });

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 6, 4]} intensity={1.3} />
      {strata.map((item, index) => {
        const ground = item.id === "land-surface";
        return (
          <group
            key={item.id}
            ref={(node) => {
              groups.current[index] = node;
            }}
          >
            <mesh
              geometry={plate}
              onClick={(event) => {
                event.stopPropagation();
                if (event.delta > 5) return;
                onSelect(selected === item.id ? null : item.id);
              }}
            >
              <meshStandardMaterial
                ref={(node) => {
                  plates.current[index] = node;
                }}
                key={ground && texture ? "image" : "tint"}
                color={ground && texture ? "#ffffff" : item.color}
                map={ground ? texture : null}
                transparent
                opacity={0}
                roughness={0.6}
                metalness={0}
                depthWrite={false}
                side={DoubleSide}
              />
            </mesh>
            <lineLoop geometry={outline}>
              <lineBasicMaterial
                color={item.color}
                transparent
                opacity={selected && selected !== item.id ? 0.3 : 0.95}
              />
            </lineLoop>
          </group>
        );
      })}
      {strataAssignments.map((assignment) => {
        const layer = layerRegistry.find(
          (item) => item.id === assignment.variableId,
        );
        const control = layers.find(
          (item) => item.id === assignment.variableId,
        );
        if (!layer || !control || !control.visible) return null;
        const dim =
          selected &&
          selected !== assignment.stratum &&
          selected !== assignment.flowsTo
            ? 0.2
            : 1;
        return (
          <StrataParticles
            key={layer.id}
            layer={layer}
            assignment={assignment}
            value={control.value}
            hasData={control.hasData}
            cap={layerParticleCap(
              formSpec(layer.id)?.encoding.maxCount ?? MAX_FORM_PARTICLES,
              openLayers,
            )}
            opacity={control.opacity * dim}
            boxesRef={boxes}
            timeRef={time}
          />
        );
      })}
    </>
  );
}
