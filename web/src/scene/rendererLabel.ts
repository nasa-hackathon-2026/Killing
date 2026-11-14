export type RendererKind = "webgpu" | "webgl";

export function rendererLabel(kind: RendererKind): "WebGPU" | "WebGL" {
  return kind === "webgpu" ? "WebGPU" : "WebGL";
}

export function rendererKindFromBackend(
  backend: { isWebGPUBackend?: boolean } | null | undefined,
): RendererKind {
  return backend?.isWebGPUBackend === true ? "webgpu" : "webgl";
}
