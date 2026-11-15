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
// blank. Both textures are released when the globe unmounts; a load that
// finishes after that is dropped, and a remount (StrictMode, HMR) starts
// over from the 2K image.
export function Earth() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const material = useRef<MeshStandardMaterial>(null);
  const detailed = useRef<Texture | null>(null);
  const requested = useRef(false);
  const mounted = useRef(false);
  const limit = useRef<number | null>(null);
  const texture = useMemo(() => loadEarthTexture(EARTH_TEXTURE_2K), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requested.current = false;
      texture.dispose();
      detailed.current?.dispose();
      detailed.current = null;
    };
  }, [texture]);

  useFrame(() => {
    if (requested.current) return;
    // The GPU limit does not change; read it until the backend reports it.
    if (limit.current === null) limit.current = maxTextureSize(gl);
    if (!shouldLoadDetailedEarth(camera.position.length(), limit.current))
      return;
    requested.current = true;
    const map = loadEarthTexture(EARTH_TEXTURE_8K, () => {
      if (!mounted.current || detailed.current !== map) return;
      if (!material.current) return;
      material.current.map = map;
      material.current.needsUpdate = true;
    });
    detailed.current = map;
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
