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
import {
  CITY_IMAGES,
  TAIWAN_IMAGE,
  contains,
  detailOpacity,
  shouldLoadDetail,
  type DetailImage,
} from "../geo/detailCoverage";
import { detailFadeMask } from "../geo/detailFade";
import { surfacePatch } from "../geo/detailPatch";
import { vectorToLatLon } from "../geo/latLon";

const DETAIL_RADIUS = 1.004;
const FADE_MASK_SIZE = 64;

function textureUrl(file: string): string {
  return file.startsWith("http") ? file : `${import.meta.env.BASE_URL}${file}`;
}

// One close-up patch: Taiwan's stitched image or one world city's GIBS tile
// (NASA GIBS shaded relief). It is lit like the globe (the same material
// type and settings as Earth.tsx), so it is neither brighter nor darker than
// the surface around it. The Taiwan patch also fades out toward its border
// (geo/detailFade.ts) instead of ending in a hard square edge; the city
// tiles keep their edges, as in #170.
function DetailMesh({ region }: { region: DetailImage }) {
  const camera = useThree((state) => state.camera);
  const mesh = useRef<Mesh>(null);
  const material = useRef<MeshStandardMaterial>(null);
  const texture = useRef<Texture | null>(null);
  const requested = useRef(false);
  const ready = useRef(false);
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
      // The patch is shown only after its image has loaded. A failed
      // download (offline, GIBS unavailable) leaves the globe's own surface
      // instead of an empty, black square.
      const map = loader.load(textureUrl(region.file), () => {
        ready.current = true;
        if (material.current) {
          material.current.map = map;
          material.current.needsUpdate = true;
        }
      });
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;
      texture.current = map;
    }
    const amount = inside ? detailOpacity(distance) : 0;
    if (material.current) material.current.opacity = amount;
    if (mesh.current) {
      mesh.current.visible = amount > 0.02 && ready.current;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry} renderOrder={1} visible={false}>
      <meshStandardMaterial
        ref={material}
        map={null}
        alphaMap={region.id === "taiwan" ? fade : null}
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
