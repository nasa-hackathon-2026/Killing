import { useEffect, useState } from "react";
import { gridUrl, type GridFetch } from "../trendmap/loadTrendMap";
import {
  FIELD_POINT_CAP,
  FIELD_POINT_CAP_LOW,
  MAX_ATTEMPTS_PER_POINT,
  fieldVariable,
  type FieldVariable,
} from "./fieldConfig";
import {
  climatologyRange,
  decodeClimatology,
  fieldGridSpec,
  placeDots,
  type FieldDots,
  type FieldGridMeta,
  type FieldGridSpec,
} from "./fieldGrid";
import type { FieldRange } from "./fieldMapping";

export type FieldData = {
  variable: FieldVariable;
  meta: FieldGridMeta;
  spec: FieldGridSpec;
  range: FieldRange;
  dots: FieldDots;
};

async function request(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

const defaultFetch: GridFetch = {
  json: async (url) => (await request(url)).json(),
  bytes: async (url) => (await request(url)).arrayBuffer(),
};

// Phones, small screens and few-core machines draw fewer dots.
export function dotCap(): number {
  if (typeof window === "undefined") return FIELD_POINT_CAP;
  const small = window.matchMedia?.("(max-width: 700px)").matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 8;
  return small || cores <= 4 ? FIELD_POINT_CAP_LOW : FIELD_POINT_CAP;
}

function seedOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function loadField(
  id: string,
  cap: number,
  fetcher: GridFetch = defaultFetch,
  url: (id: string, file: string) => string = gridUrl,
): Promise<FieldData> {
  const variable = fieldVariable(id);
  if (!variable) throw new Error(`no global distribution for ${id}`);
  const meta = (await fetcher.json(url(id, "meta.json"))) as FieldGridMeta;
  const spec = fieldGridSpec(meta);
  const months = decodeClimatology(
    await fetcher.bytes(url(id, spec.climatology.file)),
    spec,
  );
  const range = climatologyRange(months);
  if (!range) throw new Error(`no values in ${id}`);
  const dots = placeDots(
    spec,
    months,
    range,
    variable.gamma,
    cap,
    MAX_ATTEMPTS_PER_POINT,
    seedOf(id),
  );
  return { variable, meta, spec, range, dots };
}

export type FieldState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ready"; field: FieldData }
  | { status: "error" };

// One cache for the canvas layer and the legend, so a variable is fetched
// and decoded once.
const cache = new Map<string, Promise<FieldData>>();

function cachedField(id: string): Promise<FieldData> {
  let promise = cache.get(id);
  if (!promise) {
    promise = loadField(id, dotCap());
    promise.catch(() => cache.delete(id));
    cache.set(id, promise);
  }
  return promise;
}

export function useField(id: string | null): FieldState {
  const [loaded, setLoaded] = useState<{
    id: string;
    field: FieldData | null;
  } | null>(null);

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    cachedField(id)
      .then((field) => {
        if (!cancelled) setLoaded({ id, field });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, field: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id === null) return { status: "off" };
  if (!loaded || loaded.id !== id) return { status: "loading" };
  return loaded.field
    ? { status: "ready", field: loaded.field }
    : { status: "error" };
}
