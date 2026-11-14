import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Mesh,
  type MeshBasicMaterial,
  type Texture,
} from "three";
import { detailOpacity } from "../geo/detailCoverage";
import { taiwanPatch } from "../geo/detailPatch";

const DETAIL_RADIUS = 1.004;

export function TaiwanDetail() {
  const camera = useThree((state) => state.camera);
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
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
  useEffect(() => {
    return () => {
      texture.current?.dispose();
      geometry.dispose();
    };
  }, [geometry]);

  useFrame(() => {
    const distance = camera.position.length();
    if (!requested.current && distance < 1.7) {
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
      <meshBasicMaterial
        ref={material}
        map={null}
        transparent
        opacity={0}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}
