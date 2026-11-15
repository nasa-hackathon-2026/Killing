// Which Blue Marble image the globe wears. Both files are the same NASA
// Visible Earth record 57730 ("The Blue Marble: Land Surface, Ocean Color
// and Sea Ice"): the 2048 × 1024 JPEG loads with the page, and the
// 8192 × 4096 version is fetched only once the camera comes closer than
// DETAIL_LOAD_DISTANCE, on a device whose GPU takes textures that wide.
import { DETAIL_LOAD_DISTANCE } from "../geo/detailCoverage";

export const EARTH_TEXTURE_2K = "textures/blue-marble.jpg";
export const EARTH_TEXTURE_8K = "textures/blue-marble-8k.jpg";
export const DETAILED_EARTH_WIDTH = 8192;

type BackendLimits = {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
  device?: { limits?: { maxTextureDimension2D?: number } } | null;
  gl?: {
    MAX_TEXTURE_SIZE: number;
    getParameter: (name: number) => unknown;
  } | null;
};

// The widest 2D texture the GPU takes. WebGPURenderer has no
// `capabilities.maxTextureSize` (that is WebGLRenderer's), so the limit is
// read from its backend: the WebGPU device's limits, or MAX_TEXTURE_SIZE of
// the WebGL fallback. Null while the backend is not initialised. The
// renderer is typed `unknown` because WebGPURenderer does not declare its
// backend's device or WebGL context; every field read here is checked.
export function maxTextureSize(renderer: unknown): number | null {
  const backend = (renderer as { backend?: BackendLimits | null } | null)
    ?.backend;
  if (backend?.isWebGPUBackend) {
    const size = backend.device?.limits?.maxTextureDimension2D;
    return typeof size === "number" ? size : null;
  }
  if (backend?.isWebGLBackend && backend.gl) {
    const size = backend.gl.getParameter(backend.gl.MAX_TEXTURE_SIZE);
    return typeof size === "number" ? size : null;
  }
  return null;
}

export function shouldLoadDetailedEarth(
  distance: number,
  limit: number | null,
): boolean {
  return (
    distance < DETAIL_LOAD_DISTANCE &&
    limit !== null &&
    limit >= DETAILED_EARTH_WIDTH
  );
}
