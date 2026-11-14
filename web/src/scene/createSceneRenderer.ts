import type { CanvasProps } from "@react-three/fiber";
import { WebGPURenderer } from "three/webgpu";
import { rendererKindFromBackend, type RendererKind } from "./rendererLabel";

type CreateGl = NonNullable<CanvasProps["gl"]>;

export function createSceneRenderer(
  forceWebGL: boolean,
  onKind: (kind: RendererKind) => void,
): CreateGl {
  return async (props) => {
    const renderer = new WebGPURenderer({
      canvas: props.canvas as HTMLCanvasElement,
      antialias: true,
      forceWebGL,
    });
    await renderer.init();
    onKind(
      rendererKindFromBackend(
        renderer.backend as { isWebGPUBackend?: boolean },
      ),
    );
    return renderer;
  };
}
