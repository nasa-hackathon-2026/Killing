// The steps of entering and leaving the layer view:
//   off → approach (globe camera flies to the place) → on (layer view shown)
//   → closing (strata fold back) → return (globe camera flies home) → off
import { useCallback, useState } from "react";

export type StrataPhase = "off" | "approach" | "on" | "closing" | "return";

export type StrataMode = {
  phase: StrataPhase;
  // True while the layer view's own canvas is mounted.
  shown: boolean;
  enter: () => void;
  exit: () => void;
  // The globe camera reached the place.
  onArrive: () => void;
  // The strata have folded back.
  onClosed: () => void;
  // The globe camera is back where it was.
  onReturn: () => void;
};

export function nextPhase(
  phase: StrataPhase,
  event: "enter" | "exit" | "arrive" | "closed" | "return",
): StrataPhase {
  switch (event) {
    case "enter":
      return phase === "off" ? "approach" : phase;
    case "arrive":
      return phase === "approach" ? "on" : phase;
    case "exit":
      if (phase === "on") return "closing";
      if (phase === "approach") return "return";
      return phase;
    case "closed":
      return phase === "closing" ? "return" : phase;
    case "return":
      return phase === "return" ? "off" : phase;
  }
}

export function useStrataMode(startOpen: boolean): StrataMode {
  const [phase, setPhase] = useState<StrataPhase>(
    startOpen ? "approach" : "off",
  );
  const send = useCallback(
    (event: Parameters<typeof nextPhase>[1]) =>
      setPhase((current) => nextPhase(current, event)),
    [],
  );
  const enter = useCallback(() => send("enter"), [send]);
  const exit = useCallback(() => send("exit"), [send]);
  const onArrive = useCallback(() => send("arrive"), [send]);
  const onClosed = useCallback(() => send("closed"), [send]);
  const onReturn = useCallback(() => send("return"), [send]);
  return {
    phase,
    shown: phase === "on" || phase === "closing",
    enter,
    exit,
    onArrive,
    onClosed,
    onReturn,
  };
}
