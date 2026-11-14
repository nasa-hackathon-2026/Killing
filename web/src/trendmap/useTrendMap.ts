import { useEffect, useState } from "react";
import { loadTrendMap, type TrendMap } from "./loadTrendMap";

export type TrendMapState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ready"; map: TrendMap }
  | { status: "error" };

// Loads the trend map of one variable when it is selected; null = off.
export function useTrendMap(id: string | null): TrendMapState {
  const [loaded, setLoaded] = useState<{
    id: string;
    map: TrendMap | null;
  } | null>(null);

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    loadTrendMap(id)
      .then((map) => {
        if (!cancelled) setLoaded({ id, map });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, map: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id === null) return { status: "off" };
  if (!loaded || loaded.id !== id) return { status: "loading" };
  return loaded.map
    ? { status: "ready", map: loaded.map }
    : { status: "error" };
}
