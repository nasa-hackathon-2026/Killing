import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Line, LineBasicMaterial, Vector3 } from "three";
import { latLonToVector3 } from "../geo/latLon";
import { bboxCenter, bboxFrameVertices, type Bbox } from "../geo/regionFrame";

// Just above the Taiwan detail patch (TaiwanDetail, 1.004).
const FRAME_RADIUS = 1.006;

type RegionFrameProps = {
  bbox: Bbox;
  name: string;
};

// A thin outline of the data area of the selected region, lying on the
// surface, with its name at the middle. It is the sampling area of the
// area-mean series, not a border of any kind. Only the selected region is
// drawn, so the overlapping boxes of the whole island and its parts never
// show together.
export function RegionFrame({ bbox, name }: RegionFrameProps) {
  const label = useRef<HTMLParagraphElement>(null);
  const { line, center } = useMemo(() => {
    const vertices = bboxFrameVertices(bbox);
    // The renderer draws plain lines only, so the loop is closed by
    // repeating the first vertex.
    const points = [...vertices, vertices[0]].map((vertex) => {
      const at = latLonToVector3(vertex.lat, vertex.lon, FRAME_RADIUS);
      return new Vector3(at.x, at.y, at.z);
    });
    const middle = bboxCenter(bbox);
    const at = latLonToVector3(middle.lat, middle.lon, FRAME_RADIUS);
    return {
      line: new Line(
        new BufferGeometry().setFromPoints(points),
        new LineBasicMaterial({ color: "#ffd166" }),
      ),
      center: new Vector3(at.x, at.y, at.z),
    };
  }, [bbox]);
  const normal = useMemo(() => center.clone().normalize(), [center]);
  useEffect(
    () => () => {
      line.geometry.dispose();
      (line.material as LineBasicMaterial).dispose();
    },
    [line],
  );

  useFrame(({ camera }) => {
    if (label.current) {
      label.current.style.visibility =
        normal.dot(camera.position) > 1.02 ? "visible" : "hidden";
    }
  });

  return (
    <>
      <primitive object={line} />
      <Html
        position={center}
        zIndexRange={[0, 0]}
        style={{ pointerEvents: "none" }}
      >
        <p ref={label} className="place-label region-label">
          {name}
        </p>
      </Html>
    </>
  );
}
