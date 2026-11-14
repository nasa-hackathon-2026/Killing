import { describe, expect, it } from "vitest";
import { rendererKindFromBackend, rendererLabel } from "./rendererLabel";

describe("rendererLabel", () => {
  it("names a WebGPU backend", () => {
    expect(rendererLabel("webgpu")).toBe("WebGPU");
  });

  it("names a WebGL backend", () => {
    expect(rendererLabel("webgl")).toBe("WebGL");
  });
});

describe("rendererKindFromBackend", () => {
  it("reads the WebGPU flag", () => {
    expect(rendererKindFromBackend({ isWebGPUBackend: true })).toBe("webgpu");
  });

  it("treats a missing or false flag as WebGL", () => {
    expect(rendererKindFromBackend({ isWebGPUBackend: false })).toBe("webgl");
    expect(rendererKindFromBackend(null)).toBe("webgl");
    expect(rendererKindFromBackend(undefined)).toBe("webgl");
  });
});
