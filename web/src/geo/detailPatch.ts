import { TAIWAN_DETAIL } from "./detailCoverage";
import { latLonToVector3 } from "./latLon";

export type SurfacePatch = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
};

export function taiwanPatch(
  radius: number,
  rows = 64,
  columns = 64,
): SurfacePatch {
  const { south, north, west, east } = TAIWAN_DETAIL;
  const positions = new Float32Array((rows + 1) * (columns + 1) * 3);
  const uvs = new Float32Array((rows + 1) * (columns + 1) * 2);
  const indices = new Uint16Array(rows * columns * 6);
  let vertex = 0;
  for (let row = 0; row <= rows; row += 1) {
    const lat = north - (row / rows) * (north - south);
    const uvV = (lat - south) / (north - south);
    for (let column = 0; column <= columns; column += 1) {
      const lon = west + (column / columns) * (east - west);
      const point = latLonToVector3(lat, lon, radius);
      positions[vertex * 3] = point.x;
      positions[vertex * 3 + 1] = point.y;
      positions[vertex * 3 + 2] = point.z;
      uvs[vertex * 2] = (lon - west) / (east - west);
      uvs[vertex * 2 + 1] = uvV;
      vertex += 1;
    }
  }
  const stride = columns + 1;
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const northWest = row * stride + column;
      const northEast = northWest + 1;
      const southWest = northWest + stride;
      const southEast = southWest + 1;
      indices[index] = northWest;
      indices[index + 1] = southWest;
      indices[index + 2] = northEast;
      indices[index + 3] = northEast;
      indices[index + 4] = southWest;
      indices[index + 5] = southEast;
      index += 6;
    }
  }
  return { positions, uvs, indices };
}
