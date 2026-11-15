import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { DoubleSide, Quaternion, Vector3, type Mesh } from "three";
import { prefersReducedMotion } from "../forms/reducedMotion";
import { latLonToVector3 } from "../geo/latLon";
import type { MockLocation } from "../mock/snapshot";

type MarkersProps = {
  locations: MockLocation[];
  selectedId: string;
  onSelect: (id: string) => void;
};

// The ring is drawn for this camera distance and scaled with the distance to
// the surface, so it stays about the same size on screen.
const RING_REFERENCE_DISTANCE = 3.2;
const PULSE_SECONDS = 2.4;
const OUTWARD = new Vector3(0, 0, 1);

// A ring around the selected place and its name, so the place the panels
// talk about can be found at a glance. The outer ring pulses unless the
// reader asked for reduced motion.
function SelectedPlace({ location }: { location: MockLocation }) {
  const ring = useRef<Mesh>(null);
  const pulse = useRef<Mesh>(null);
  const label = useRef<HTMLParagraphElement>(null);
  const { position, normal, facing } = useMemo(() => {
    const at = latLonToVector3(location.lat, location.lon, 1.009);
    const point = new Vector3(at.x, at.y, at.z);
    const unit = point.clone().normalize();
    return {
      position: point,
      normal: unit,
      facing: new Quaternion().setFromUnitVectors(OUTWARD, unit),
    };
  }, [location.lat, location.lon]);

  useFrame(({ camera, clock }) => {
    const size = Math.min(
      1.6,
      Math.max(
        0.12,
        (camera.position.length() - 1) / (RING_REFERENCE_DISTANCE - 1),
      ),
    );
    ring.current?.scale.setScalar(size);
    if (pulse.current) {
      const phase = prefersReducedMotion()
        ? 0
        : (clock.elapsedTime % PULSE_SECONDS) / PULSE_SECONDS;
      pulse.current.scale.setScalar(size * (1 + 1.4 * phase));
      const material = pulse.current.material;
      if (!Array.isArray(material)) material.opacity = 0.7 * (1 - phase);
      pulse.current.visible = !prefersReducedMotion();
    }
    // A point of the unit sphere is on the near side when the camera is
    // above its tangent plane.
    if (label.current) {
      label.current.style.visibility =
        normal.dot(camera.position) > 1.02 ? "visible" : "hidden";
    }
  });

  return (
    <>
      <mesh ref={ring} position={position} quaternion={facing}>
        <ringGeometry args={[0.024, 0.031, 48]} />
        <meshBasicMaterial color="#ffffff" side={DoubleSide} />
      </mesh>
      <mesh ref={pulse} position={position} quaternion={facing}>
        <ringGeometry args={[0.031, 0.036, 48]} />
        <meshBasicMaterial
          color="#ffffff"
          side={DoubleSide}
          transparent
          opacity={0.7}
          depthWrite={false}
        />
      </mesh>
      <Html
        position={position}
        zIndexRange={[0, 0]}
        style={{ pointerEvents: "none" }}
      >
        <p ref={label} className="place-label">
          {location.nameEn}
        </p>
      </Html>
    </>
  );
}

export function Markers({ locations, selectedId, onSelect }: MarkersProps) {
  const chosen = locations.find((location) => location.id === selectedId);
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
      {chosen ? <SelectedPlace key={chosen.id} location={chosen} /> : null}
    </>
  );
}
