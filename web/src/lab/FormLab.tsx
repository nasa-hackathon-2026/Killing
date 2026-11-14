import { Canvas, useFrame } from "@react-three/fiber";
import { useRef, useState, type RefObject } from "react";
import { formRegistry, type FormDefinition } from "../forms/registry";
import { mockVariables } from "../mock/snapshot";
import { createSceneRenderer } from "../scene/createSceneRenderer";
import { FpsReadout } from "../scene/FpsReadout";
import { rendererLabel, type RendererKind } from "../scene/rendererLabel";

function Clock({
  playing,
  timeRef,
}: {
  playing: boolean;
  timeRef: RefObject<number>;
}) {
  useFrame((_, delta) => {
    if (playing) timeRef.current += delta;
  });
  return null;
}

function Stage({
  form,
  value,
  playing,
}: {
  form: FormDefinition;
  value: number;
  playing: boolean;
}) {
  const time = useRef(0);
  const opacity = useRef(1);
  const variable = mockVariables.find((item) => item.id === form.variableId);
  const FormParticles = form.Component;

  return (
    <>
      <color attach="background" args={["#0b1220"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 2, 4]} intensity={1.1} />
      <Clock playing={playing} timeRef={time} />
      <FormParticles
        value={value}
        timeRef={time}
        opacityRef={opacity}
        color={variable?.particleColor ?? "#ffffff"}
      />
    </>
  );
}

export function FormLab() {
  const [formId, setFormId] = useState(formRegistry[0]?.id ?? "water-droplet");
  const [value, setValue] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [kind, setKind] = useState<RendererKind>("webgl");
  const form =
    formRegistry.find((item) => item.id === formId) ?? formRegistry[0];

  return (
    <div className="app">
      {form ? (
        <Canvas
          camera={{ position: [0, 0, 3.2], fov: 45 }}
          dpr={[1, 2]}
          gl={createSceneRenderer(false, setKind)}
        >
          <Stage form={form} value={value} playing={playing} />
        </Canvas>
      ) : null}
      <div className="hud">
        <p className="badge">Renderer: {rendererLabel(kind)}</p>
        <FpsReadout />
        <a href={import.meta.env.BASE_URL}>Earth</a>
        <label>
          Form
          <select
            value={form?.id}
            onChange={(event) =>
              setFormId(event.target.value as FormDefinition["id"])
            }
          >
            {formRegistry.map((item) => (
              <option key={item.id} value={item.id}>
                {item.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label>
          Value
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={value}
            aria-label="Form value"
            onChange={(event) => setValue(Number(event.target.value))}
          />
        </label>
        <p className="badge">{value.toFixed(2)}</p>
        <button type="button" onClick={() => setPlaying((current) => !current)}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}
