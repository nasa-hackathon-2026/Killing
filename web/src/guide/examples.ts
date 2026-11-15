// The "Try an example" buttons of the start card. One entry is one example:
// a neutral question and the existing view it opens. An example only sets
// state the page already has (layers, place, chart, layer view, trend map,
// or one of the sub-pages), and every one is an ordinary link, so it can be
// opened from its URL alone. Titles are questions and never give the answer.

// The parameters of the main view an example may set (see urlParams.ts).
export type ExampleView = {
  layers?: string[];
  // Place id (`?at=`).
  place?: string;
  // Variable of the time series chart.
  chart?: string;
  // Open the layer view.
  strata?: boolean;
  // Variable of the global trend map.
  trendmap?: string;
};

export type GuideExample = {
  id: string;
  // Shown on the button. A question, with no answer in it.
  question: string;
  // What opens, in a few words.
  opens: string;
} & (
  | { view: ExampleView }
  // A sub-page (path under the site base, with a trailing slash) and its
  // own query parameters.
  | { page: string; params: Record<string, string> }
);

export const GUIDE_EXAMPLES: GuideExample[] = [
  {
    id: "rainfall-taichung",
    question: "Has rainfall at Taichung changed since 2001?",
    opens: "Precipitation layer and its time series chart",
    view: {
      layers: ["imerg_precip"],
      place: "taichung",
      chart: "imerg_precip",
    },
  },
  {
    id: "no2-los-angeles",
    question: "Has tropospheric NO₂ over Los Angeles changed since 2005?",
    opens: "Tropospheric NO₂ layer and its time series chart at a world city",
    view: {
      layers: ["omi_no2"],
      place: "los_angeles",
      chart: "omi_no2",
    },
  },
  {
    id: "layers-of-the-air",
    question:
      "Which layer of the atmosphere or ground does each variable belong to?",
    opens: "Layer view with six layers switched on",
    view: {
      layers: [
        "omi_o3",
        "omi_no2",
        "imerg_precip",
        "merra2_t2m",
        "modis_ndvi",
        "gldas_soilmoist",
      ],
      place: "taichung",
      strata: true,
    },
  },
  {
    id: "model-vs-station",
    question: "Do a model and a station agree on temperature?",
    opens: "Model vs observation page, MERRA-2 and the Taichung station",
    page: "compare/",
    params: { pair: "merra2_t2m__station_temp__taichung_station" },
  },
  {
    id: "global-trend-map",
    question:
      "Where on Earth has 2 m air temperature changed, and where is that change significant?",
    opens: "Global trend map of MERRA-2 2 m air temperature",
    view: { layers: ["merra2_t2m"], trendmap: "merra2_t2m" },
  },
];

// The query string of a view, in a fixed order, without the leading "?".
// Ids are plain ASCII, so the commas of `layers` stay readable.
export function viewQuery(view: ExampleView): string {
  const parts: string[] = [];
  if (view.layers && view.layers.length > 0) {
    parts.push(`layers=${view.layers.map(encodeURIComponent).join(",")}`);
  }
  if (view.place) parts.push(`at=${encodeURIComponent(view.place)}`);
  if (view.chart) parts.push(`chart=${encodeURIComponent(view.chart)}`);
  if (view.strata) parts.push("strata=1");
  if (view.trendmap) {
    parts.push(`trendmap=${encodeURIComponent(view.trendmap)}`);
  }
  return parts.join("&");
}

// The link of an example under the site base (import.meta.env.BASE_URL,
// which ends with "/").
export function exampleHref(example: GuideExample, base: string): string {
  if ("view" in example) {
    const query = viewQuery(example.view);
    return query ? `${base}?${query}` : base;
  }
  const query = new URLSearchParams(example.params).toString();
  return `${base}${example.page}${query ? `?${query}` : ""}`;
}
