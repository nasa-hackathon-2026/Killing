import { latLonToVector3, type Vector3Tuple } from "../geo/latLon";

type Vector = { x: number; y: number; z: number };

function unitAt(lat: number, lon: number): Vector {
  const point = latLonToVector3(lat, lon);
  const magnitude = Math.hypot(point.x, point.y, point.z);
  return {
    x: point.x / magnitude,
    y: point.y / magnitude,
    z: point.z / magnitude,
  };
}

function cross(first: Vector, second: Vector): Vector {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function normalize(vector: Vector): Vector {
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function antipodalAxis(start: Vector): Vector {
  const basis =
    Math.abs(start.x) <= Math.abs(start.y) &&
    Math.abs(start.x) <= Math.abs(start.z)
      ? { x: 1, y: 0, z: 0 }
      : Math.abs(start.y) <= Math.abs(start.z)
        ? { x: 0, y: 1, z: 0 }
        : { x: 0, y: 0, z: 1 };
  return normalize(cross(start, basis));
}

export function greatCircleArcPoints(
  sourceLat: number,
  sourceLon: number,
  targetLat: number,
  targetLon: number,
  segments = 32,
  radius = 1.05,
): Vector3Tuple[] {
  const count = Math.max(1, Math.floor(segments));
  const start = unitAt(sourceLat, sourceLon);
  const end = unitAt(targetLat, targetLon);
  const dot = Math.max(
    -1,
    Math.min(1, start.x * end.x + start.y * end.y + start.z * end.z),
  );
  const angle = Math.acos(dot);
  const rawAxis = cross(start, end);
  const axisMagnitude = Math.hypot(rawAxis.x, rawAxis.y, rawAxis.z);
  const axis =
    axisMagnitude > 1e-12
      ? {
          x: rawAxis.x / axisMagnitude,
          y: rawAxis.y / axisMagnitude,
          z: rawAxis.z / axisMagnitude,
        }
      : antipodalAxis(start);
  const tangent = cross(axis, start);

  return Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0) {
      return { x: start.x * radius, y: start.y * radius, z: start.z * radius };
    }
    if (index === count) {
      return { x: end.x * radius, y: end.y * radius, z: end.z * radius };
    }
    const fraction = index / count;
    const rotation = angle * fraction;
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const rotated = normalize({
      x: start.x * cosine + tangent.x * sine,
      y: start.y * cosine + tangent.y * sine,
      z: start.z * cosine + tangent.z * sine,
    });
    return {
      x: rotated.x * radius,
      y: rotated.y * radius,
      z: rotated.z * radius,
    };
  });
}
