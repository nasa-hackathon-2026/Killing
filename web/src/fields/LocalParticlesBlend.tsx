import { useFrame } from "@react-three/fiber";
import { useRef, type ReactNode } from "react";
import type { Group, Material, Object3D } from "three";
import { fieldFrame } from "./fieldFrame";

const wrapped = new WeakSet<Material>();

// Makes the opacity a material is given come out multiplied by
// fieldFrame.local when the renderer reads it. The particle components keep
// writing their own opacity every frame and need no change; it does not
// matter in which order the frame callbacks run.
function wrapOpacity(material: Material): void {
  if (wrapped.has(material)) return;
  wrapped.add(material);
  let own = material.opacity;
  Object.defineProperty(material, "opacity", {
    configurable: true,
    enumerable: true,
    get: () => own * fieldFrame.local,
    set: (value: number) => {
      own = value;
    },
  });
}

function materialsOf(object: Object3D): Material[] {
  const material = (object as { material?: Material | Material[] }).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

// Wraps the place's particle layers (GlassParticleLayer and its forms, Lively
// or Calm alike): with the global distribution on they fade when the camera
// is far (see nearFarBlend). With it off, fieldFrame.local stays 1 and
// nothing changes.
export function LocalParticlesBlend({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(() => {
    group.current?.traverse((object) => {
      for (const material of materialsOf(object)) {
        if (material.transparent) wrapOpacity(material);
      }
    });
  });
  return <group ref={group}>{children}</group>;
}
