import {
  decodeSignificance,
  decodeSlopes,
  paintTrendMap,
  symmetricLimit,
  trendGridSpec,
  type TrendGridMeta,
  type TrendGridSpec,
} from "./trendGrid";
import {
  PALETTES,
  trendMapVariable,
  type TrendMapVariable,
} from "./trendMapConfig";

export type TrendMap = {
  variable: TrendMapVariable;
  meta: TrendGridMeta;
  spec: TrendGridSpec;
  // Half-width of the colour range, in the unit of the file.
  limit: number;
  // RGBA, nLon × nLat, first row = southernmost.
  pixels: Uint8Array;
};

export type GridFetch = {
  json: (url: string) => Promise<unknown>;
  bytes: (url: string) => Promise<ArrayBuffer>;
};

export function gridUrl(id: string, file: string): string {
  return `${import.meta.env.BASE_URL}data/grid/${id}/${file}`;
}

async function request(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

const defaultFetch: GridFetch = {
  json: async (url) => (await request(url)).json(),
  bytes: async (url) => (await request(url)).arrayBuffer(),
};

export async function loadTrendMap(
  id: string,
  fetcher: GridFetch = defaultFetch,
  url: (id: string, file: string) => string = gridUrl,
): Promise<TrendMap> {
  const variable = trendMapVariable(id);
  if (!variable) throw new Error(`no trend map for ${id}`);
  const meta = (await fetcher.json(url(id, "meta.json"))) as TrendGridMeta;
  const spec = trendGridSpec(meta);
  const [slopeBytes, significanceBytes] = await Promise.all([
    fetcher.bytes(url(id, spec.slope.file)),
    fetcher.bytes(url(id, spec.significance.file)),
  ]);
  const slopes = decodeSlopes(slopeBytes, spec);
  const significance = decodeSignificance(significanceBytes, spec);
  const limit = symmetricLimit(slopes);
  return {
    variable,
    meta,
    spec,
    limit,
    pixels: paintTrendMap(
      slopes,
      significance,
      limit,
      PALETTES[variable.palette],
    ),
  };
}
