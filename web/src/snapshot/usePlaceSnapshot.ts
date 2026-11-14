import { useEffect, useState } from "react";
import { loadPlaceSnapshot, type PlaceSnapshot } from "./loadSnapshot";

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; data: PlaceSnapshot }
  | { status: "error" };

export function usePlaceSnapshot(): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadPlaceSnapshot()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
