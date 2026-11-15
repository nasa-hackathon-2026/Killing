import { describe, expect, it } from "vitest";
import {
  barScale,
  edgePath,
  edgeWidth,
  filterRulesByVariable,
  formatR,
  gapFeatureLabel,
  gapFoldVerdict,
  labelGapTreeText,
  networkLayout,
  ruleChip,
  ruleVariables,
  runningMean,
  segmentLabel,
  significantEdges,
  similarKey,
  similarLink,
  similarSelection,
  sparkPath,
  stratumOfVariable,
  variablesAt,
  type GapFold,
  type GapTreeFile,
  type GraphEdge,
  type GraphTable,
} from "./miningPlus";

describe("rule labels", () => {
  it("splits an item into variable, state and timing", () => {
    expect(ruleChip("prev:omi_o3=low")).toEqual({
      variableId: "omi_o3",
      state: "low",
      previousMonth: true,
    });
    expect(ruleChip("imerg_precip=high").previousMonth).toBe(false);
  });

  it("filters rules by a variable on either side", () => {
    const rules = [
      { antecedents: ["a=high", "prev:b=low"], consequent: "c=high" },
      { antecedents: ["d=low"], consequent: "a=low" },
      { antecedents: ["d=low"], consequent: "c=low" },
    ];
    expect(ruleVariables(rules[0]!)).toEqual(["a", "b", "c"]);
    expect(filterRulesByVariable(rules, "all")).toHaveLength(3);
    expect(filterRulesByVariable(rules, "a")).toHaveLength(2);
    expect(filterRulesByVariable(rules, "b")).toEqual([rules[0]]);
  });
});

function edge(partial: Partial<GraphEdge>): GraphEdge {
  return {
    edge_id: 1,
    source: "a",
    target: "b",
    lag: 0,
    r: 0.5,
    n_eff: 100,
    n_months_median: 200,
    n_locations: 4,
    r_min: 0.4,
    r_max: 0.6,
    same_sign_in_all_locations: true,
    p: 0.001,
    q: 0.01,
    significant: true,
    known_issues: false,
    ...partial,
  };
}

describe("variable network", () => {
  it("puts layer variables on their stratum and others by category", () => {
    expect(stratumOfVariable("omi_o3", "atmosphere.gas.o3")).toBe(
      "stratosphere",
    );
    expect(
      stratumOfVariable("power_t2m", "atmosphere.temperature.near_surface"),
    ).toBe("near-surface");
    expect(stratumOfVariable("modis_ndvi_pc", "land.vegetation.ndvi")).toBe(
      "land-surface",
    );
  });

  it("lays every variable out once, rows from the top of the atmosphere down", () => {
    const layout = networkLayout(
      [
        { id: "gldas_soilmoist", categoryPath: "land.water.soil_moisture" },
        { id: "omi_o3", categoryPath: "atmosphere.gas.o3" },
        { id: "gldas_tair", categoryPath: "" },
        { id: "merra2_t2m", categoryPath: "" },
      ],
      1000,
      100,
      200,
    );
    expect(layout.nodes).toHaveLength(4);
    expect(layout.height).toBe(600);
    const y = (id: string) =>
      layout.nodes.find((node) => node.variableId === id)?.y ?? 0;
    expect(y("omi_o3")).toBeLessThan(y("gldas_tair"));
    expect(y("gldas_tair")).toBeLessThan(y("gldas_soilmoist"));
    const air = layout.nodes.filter((node) => node.stratum === "near-surface");
    expect(air.map((node) => node.x)).toEqual([400, 800]);
    expect(air.map((node) => node.above)).toEqual([true, false]);
    for (const node of layout.nodes) expect(node.x).toBeGreaterThan(200);
  });

  it("keeps significant edges of the chosen timing, strongest first", () => {
    const table = {
      edges: [
        edge({ edge_id: 1, r: 0.2 }),
        edge({ edge_id: 2, r: -0.7, lag: 1 }),
        edge({ edge_id: 3, r: 0.9, significant: false }),
      ],
    } as GraphTable;
    expect(significantEdges(table, "all").map((item) => item.edge_id)).toEqual([
      2, 1,
    ]);
    expect(significantEdges(table, 0).map((item) => item.edge_id)).toEqual([1]);
  });

  it("draws wider lines for larger |r| and signs r", () => {
    expect(edgeWidth(-0.8)).toBeGreaterThan(edgeWidth(0.2));
    expect(formatR(0.456)).toBe("+0.46");
    expect(formatR(-0.5)).toBe("−0.50");
    expect(edgePath({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)).toBe(
      "M0.0,0.0 Q5.0,5.0 10.0,0.0",
    );
  });
});

const similar = {
  variable_names: { rain: "Rain", ozone: "Ozone", ndvi: "NDVI" },
  locations: {
    taipei: { name_en: "Taipei", group: "taiwan" },
    tokyo: { name_en: "Tokyo", group: "world_city" },
  },
  series: {
    rain__taipei__point: {
      variable_id: "rain",
      location_id: "taipei",
      aggregation: "point",
      known_issues: [],
      n_filled: 0,
      z: [],
    },
    ndvi__taipei__point: {
      variable_id: "ndvi",
      location_id: "taipei",
      aggregation: "point",
      known_issues: [],
      n_filled: 0,
      z: [],
    },
    ozone__tokyo__point: {
      variable_id: "ozone",
      location_id: "tokyo",
      aggregation: "point",
      known_issues: [],
      n_filled: 0,
      z: [],
    },
  },
};

describe("similar series", () => {
  it("lists the variables a place has, in catalog order", () => {
    expect(variablesAt(similar, "taipei")).toEqual(["rain", "ndvi"]);
    expect(similarKey(similar, "tokyo", "ozone")).toBe("ozone__tokyo__point");
    expect(similarKey(similar, "tokyo", "ndvi")).toBeNull();
  });

  it("reads the selection from the address and falls back when unknown", () => {
    expect(similarSelection(similar, "?place=tokyo&variable=ozone")).toEqual({
      locationId: "tokyo",
      variableId: "ozone",
    });
    // Tokyo has no NDVI series: its first variable is used instead
    expect(similarSelection(similar, "?place=tokyo&variable=ndvi")).toEqual({
      locationId: "tokyo",
      variableId: "ozone",
    });
    expect(similarSelection(similar, "?place=mars")).toEqual({
      locationId: "taipei",
      variableId: "rain",
    });
  });

  it("builds the link the main page uses", () => {
    expect(similarLink("/base/", "tokyo", "imerg_precip")).toBe(
      "/base/mining/?place=tokyo&variable=imerg_precip#similar",
    );
  });

  it("draws a clipped sparkline and a running mean", () => {
    expect(sparkPath([0, 2, -9], 100, 40, 2)).toBe(
      "M0.0,20.0L50.0,0.0L100.0,40.0",
    );
    expect(sparkPath([1], 100, 40, 2)).toBe("");
    expect(runningMean([1, 2, 3, 4], 2)).toEqual([1.5, 2.5, 3.5]);
  });
});

const gap = {
  segments: [
    { segment: 1, first_month: null },
    { segment: 2, first_month: "2011-05-01" },
    { segment: 3, first_month: "2017-07-01" },
  ],
  pairs: [
    {
      pair_id: "p",
      model: "gldas_tair",
      station: "taipei_station",
      station_name_en: "Taipei (CWA / WMO 58968)",
      n_months: 297,
      context_point: "taipei",
      context_distance_km: 5.2,
    },
  ],
  variable_names: { imerg_precip: "Precipitation" },
} as unknown as GapTreeFile;

describe("gap tree", () => {
  it("names segments by their months", () => {
    expect(segmentLabel(gap, "1")).toBe("before 2011-05");
    expect(segmentLabel(gap, "2")).toBe("2011-05 up to 2017-07");
    expect(segmentLabel(gap, "3")).toBe("from 2017-07");
  });

  it("puts features into words, also inside the tree text", () => {
    expect(gapFeatureLabel(gap, "station:taipei_station")).toBe(
      "station is Taipei",
    );
    expect(gapFeatureLabel(gap, "ctx:imerg_precip")).toBe(
      "state of Precipitation",
    );
    expect(
      labelGapTreeText(gap, "if calendar_month <= 6.5:\n  -> small (n = 3)\n"),
    ).toBe("if calendar month <= 6.5:\n  -> small (n = 3)\n");
  });

  it("names the baselines a fold does not beat", () => {
    const fold = {
      above_train_majority: true,
      above_persistence: false,
      above_calendar_month: false,
    } as GapFold;
    expect(gapFoldVerdict(fold)).toBe(
      "not above: persistence guess, calendar-month guess",
    );
    expect(
      gapFoldVerdict({
        ...fold,
        above_persistence: true,
        above_calendar_month: true,
      }),
    ).toBe("above all three baselines");
  });

  it("scales bars to the largest upper bound", () => {
    const row = {
      model: "m",
      group: "g",
      n_months: 1,
      median_abs_difference: 0,
    };
    expect(
      barScale([
        { ...row, mean_abs_difference: 0.5, ci: [0.4, 0.6] },
        { ...row, mean_abs_difference: 0.7, ci: [null, null] },
      ]),
    ).toBe(0.7);
  });
});
