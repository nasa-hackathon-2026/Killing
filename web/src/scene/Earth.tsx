import { useEffect, useMemo } from "react";
import { SRGBColorSpace, TextureLoader } from "three";
import { EARTH_RADIUS } from "../geo/latLon";

export function Earth() {
  const texture = useMemo(() => {
    const map = new TextureLoader().load(
      `${import.meta.env.BASE_URL}textures/blue-marble.jpg`,
    );
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  }, []);

  useEffect(() => {
    return () => texture.dispose();
  }, [texture]);

  return (
    <mesh>
      <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  );
}
