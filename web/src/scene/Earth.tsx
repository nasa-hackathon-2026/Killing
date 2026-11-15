import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  SRGBColorSpace,
  TextureLoader,
  type MeshStandardMaterial,
  type Texture,
} from "three";
import { EARTH_RADIUS } from "../geo/latLon";
import {
  EARTH_TEXTURE_2K,
  EARTH_TEXTURE_8K,
  maxTextureSize,
  shouldLoadDetailedEarth,
} from "./earthTexture";

function loadEarthTexture(file: string, onLoad?: (map: Texture) => void) {
  const map = new TextureLoader().load(
    `${import.meta.env.BASE_URL}${file}`,
    onLoad,
  );
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

// The globe's surface: the 2K Blue Marble at first, swapped for the 8K
// version of the same image once the camera comes close (earthTexture.ts).
// The swap happens after the 8K file has loaded, so the surface never goes
// blank; the 2K texture is then released.
export function Earth() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const material = useRef<MeshStandardMaterial>(null);
  const detailed = useRef<Texture | null>(null);
  const requested = useRef(false);
  const texture = useMemo(() => loadEarthTexture(EARTH_TEXTURE_2K), []);

  useEffect(() => {
    return () => {
      texture.dispose();
      detailed.current?.dispose();
    };
  }, [texture]);

  useFrame(() => {
    if (requested.current) return;
    const limit = maxTextureSize(
      gl as unknown as Parameters<typeof maxTextureSize>[0],
    );
    if (!shouldLoadDetailedEarth(camera.position.length(), limit)) return;
    requested.current = true;
    detailed.current = loadEarthTexture(EARTH_TEXTURE_8K, (map) => {
      if (!material.current) return;
      material.current.map = map;
      material.current.needsUpdate = true;
      texture.dispose();
    });
  });

  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshStandardMaterial
        ref={material}
        map={texture}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}
