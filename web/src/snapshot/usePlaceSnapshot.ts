import { useEffect, useState } from "react";
import {
  loadPlaceSeries,
  loadPlaceSnapshot,
  type PlaceSnapshot,
} from "./loadSnapshot";

export type SnapshotState =
  | { status: "loading" }
  | { status: "ready"; data: PlaceSnapshot }
  | { status: "error" };

// Reads the catalogs and Taiwan's series once, then the series of
// `locationId` when it is a world place that has not been read yet.
export function usePlaceSnapshot(locationId: string): SnapshotState {
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

  const data = state.status === "ready" ? state.data : null;
  useEffect(() => {
    if (!data || data.loaded.includes(locationId)) return;
    if (!data.places.some((place) => place.id === locationId)) return;
    let cancelled = false;
    loadPlaceSeries(data, locationId)
      .then((next) => {
        if (cancelled) return;
        // Merge into whatever is current: another place may have finished
        // loading in the meantime.
        setState((current) =>
          current.status !== "ready" || current.data.loaded.includes(locationId)
            ? current
            : {
                status: "ready",
                data: {
                  ...current.data,
                  series: [
                    ...current.data.series,
                    ...next.series.filter(
                      (item) => item.locationId === locationId,
                    ),
                  ],
                  loaded: [...current.data.loaded, locationId],
                  pending: current.data.pending.filter(
                    (entry) => entry.locationId !== locationId,
                  ),
                },
              },
        );
      })
      .catch(() => {
        // The files of this place could not be read: mark it loaded with
        // no series, so the layers say there is no data rather than wait.
        if (cancelled) return;
        setState((current) =>
          current.status !== "ready" || current.data.loaded.includes(locationId)
            ? current
            : {
                status: "ready",
                data: {
                  ...current.data,
                  loaded: [...current.data.loaded, locationId],
                },
              },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [data, locationId]);

  return state;
}
