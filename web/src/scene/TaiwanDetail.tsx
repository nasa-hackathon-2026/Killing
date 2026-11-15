import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  TextureLoader,
  type Mesh,
  type MeshStandardMaterial,
  type Texture,
} from "three";
import { DETAIL_LOAD_DISTANCE, detailOpacity } from "../geo/detailCoverage";
import { detailFadeMask } from "../geo/detailFade";
import { taiwanPatch } from "../geo/detailPatch";

const DETAIL_RADIUS = 1.004;
const FADE_MASK_SIZE = 64;

// The Taiwan close-up (NASA GIBS shaded relief). It is lit like the globe
// (the same material type and settings as Earth.tsx), so it is neither
// brighter nor darker than the surface around it, and it fades out toward
// its border (geo/detailFade.ts) instead of ending in a hard square edge.
export function TaiwanDetail() {
  const camera = useThree((state) => state.camera);
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const texture = useRef<Texture | null>(null);
  const requested = useRef(false);
  const geometry = useMemo(() => {
    const patch = taiwanPatch(DETAIL_RADIUS);
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(patch.positions, 3));
    buffer.setAttribute("uv", new BufferAttribute(patch.uvs, 2));
    buffer.setIndex(new BufferAttribute(patch.indices, 1));
    buffer.computeVertexNormals();
    return buffer;
  }, []);
  const fade = useMemo(() => {
    const mask = new DataTexture(
      detailFadeMask(FADE_MASK_SIZE),
      FADE_MASK_SIZE,
      FADE_MASK_SIZE,
      RGBAFormat,
    );
    mask.magFilter = LinearFilter;
    mask.minFilter = LinearFilter;
    mask.needsUpdate = true;
    return mask;
  }, []);
  useEffect(() => {
    return () => {
      texture.current?.dispose();
      geometry.dispose();
      fade.dispose();
    };
  }, [geometry, fade]);

  useFrame(() => {
    const distance = camera.position.length();
    if (!requested.current && distance < DETAIL_LOAD_DISTANCE) {
      requested.current = true;
      const map = new TextureLoader().load(
        `${import.meta.env.BASE_URL}textures/taiwan-detail.png`,
      );
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
      texture.current = map;
      if (material.current) {
        material.current.map = map;
        material.current.needsUpdate = true;
      }
    }
    const amount = detailOpacity(distance);
    if (material.current) material.current.opacity = amount;
    if (mesh.current) {
      mesh.current.visible = amount > 0.02 && texture.current !== null;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={1} visible={false}>
      <meshStandardMaterial
        ref={material}
        map={null}
        alphaMap={fade}
        roughness={1}
        metalness={0}
        transparent
        opacity={0}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}
