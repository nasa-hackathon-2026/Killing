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
import {
  CITY_IMAGES,
  TAIWAN_IMAGE,
  contains,
  detailOpacity,
  shouldLoadDetail,
  type DetailImage,
} from "../geo/detailCoverage";
import { surfacePatch } from "../geo/detailPatch";
import { vectorToLatLon } from "../geo/latLon";

const DETAIL_RADIUS = 1.004;

function textureUrl(file: string): string {
  return file.startsWith("http") ? file : `${import.meta.env.BASE_URL}${file}`;
}

function DetailMesh({ region }: { region: DetailImage }) {
  const camera = useThree((state) => state.camera);
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);
  const texture = useRef<Texture | null>(null);
  const requested = useRef(false);
  const rows = region.id === "taiwan" ? 64 : 24;
  const geometry = useMemo(() => {
    const patch = surfacePatch(region, DETAIL_RADIUS, rows, rows);
    const buffer = new BufferGeometry();
    buffer.setAttribute("position", new BufferAttribute(patch.positions, 3));
    buffer.setAttribute("uv", new BufferAttribute(patch.uvs, 2));
    buffer.setIndex(new BufferAttribute(patch.indices, 1));
    buffer.computeVertexNormals();
    return buffer;
  }, [region, rows]);
  useEffect(() => {
    return () => {
      texture.current?.dispose();
      geometry.dispose();
    };
  }, [geometry]);

  useFrame(() => {
    const distance = camera.position.length();
    const ground = vectorToLatLon(
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
    const inside = contains(region, ground.lat, ground.lon);
    if (!requested.current && shouldLoadDetail(distance, inside)) {
      requested.current = true;
      const loader = new TextureLoader();
      loader.setCrossOrigin("anonymous");
      const map = loader.load(textureUrl(region.file));
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
      texture.current = map;
      if (material.current) {
        material.current.map = map;
        material.current.needsUpdate = true;
      }
    }
    const amount = inside ? detailOpacity(distance) : 0;
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

// Taiwan's stitched image, plus one GIBS tile per world city. A tile is
// requested only when the camera is close and over that patch.
export function DetailSurface() {
  return (
    <>
      <DetailMesh region={TAIWAN_IMAGE} />
      {CITY_IMAGES.map((region) => (
        <DetailMesh key={region.id} region={region} />
      ))}
    </>
  );
}
