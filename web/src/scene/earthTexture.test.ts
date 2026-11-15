import { describe, expect, it } from "vitest";
import { maxTextureSize, shouldLoadDetailedEarth } from "./earthTexture";

describe("the device's texture size limit", () => {
  it("is the WebGPU device's 2D texture limit", () => {
    const backend = {
      isWebGPUBackend: true,
      device: { limits: { maxTextureDimension2D: 8192 } },
    };
    expect(maxTextureSize({ backend })).toBe(8192);
  });

  it("is MAX_TEXTURE_SIZE on the WebGL fallback", () => {
    const MAX_TEXTURE_SIZE = 0x0d33;
    const gl = {
      MAX_TEXTURE_SIZE,
      getParameter: (name: number) => (name === MAX_TEXTURE_SIZE ? 4096 : 0),
    };
    expect(maxTextureSize({ backend: { isWebGLBackend: true, gl } })).toBe(
      4096,
    );
  });

  it("is unknown when the backend is not ready", () => {
    expect(maxTextureSize({ backend: { isWebGPUBackend: true } })).toBeNull();
    expect(maxTextureSize({})).toBeNull();
  });
});

describe("switching the globe to the 8K Blue Marble", () => {
  it("switches when the camera is closer than 1.7 and the device takes 8192 px textures", () => {
    expect(shouldLoadDetailedEarth(1.5, 16384)).toBe(true);
    expect(shouldLoadDetailedEarth(1.69, 8192)).toBe(true);
  });

  it("keeps the 2K image at 1.7 and farther", () => {
    expect(shouldLoadDetailedEarth(1.7, 16384)).toBe(false);
    expect(shouldLoadDetailedEarth(3, 16384)).toBe(false);
  });

  it("keeps the 2K image when the device's texture limit is below 8192 or unknown", () => {
    expect(shouldLoadDetailedEarth(1.3, 4096)).toBe(false);
    expect(shouldLoadDetailedEarth(1.3, null)).toBe(false);
  });
});
