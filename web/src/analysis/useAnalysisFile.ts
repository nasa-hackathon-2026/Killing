import { useEffect, useState } from "react";

export type AnalysisState<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

// Loads one analysis result file once. `load` must be a stable reference
// (a module-level function).
export function useAnalysisFile<T>(load: () => Promise<T>): AnalysisState<T> {
  const [state, setState] = useState<AnalysisState<T>>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    load()
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return state;
}
