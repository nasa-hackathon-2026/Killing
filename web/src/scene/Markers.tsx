import { latLonToVector3 } from "../geo/latLon";
import type { MockLocation } from "../mock/snapshot";

type MarkersProps = {
  locations: MockLocation[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function Markers({ locations, selectedId, onSelect }: MarkersProps) {
  return (
    <>
      {locations.map((location) => {
        const position = latLonToVector3(location.lat, location.lon, 1.008);
        const selected = location.id === selectedId;
        return (
          <mesh
            key={location.id}
            position={[position.x, position.y, position.z]}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(location.id);
            }}
          >
            <sphereGeometry args={[selected ? 0.01 : 0.006, 12, 12]} />
            <meshBasicMaterial color={selected ? "#ffffff" : "#ffd166"} />
          </mesh>
        );
      })}
    </>
  );
}
