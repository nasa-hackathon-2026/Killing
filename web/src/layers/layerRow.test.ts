import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setRole } from "../i18n";
import { LayerPanel } from "./LayerPanel";
import { LayerRow, type LayerRowProps } from "./LayerRow";
import { layerRegistry } from "./registry";

const noop = () => {};

function layer(id: string) {
  const found = layerRegistry.find((item) => item.id === id);
  if (!found) throw new Error(`no layer ${id}`);
  return found;
}

const base: LayerRowProps = {
  layer: layer("gldas_tair"),
  control: { id: "gldas_tair", visible: false, opacity: 0.8 },
  reading: "28.0 °C",
  trend: {
    headline: "Rising 0.31 °C per decade",
    significance: "significant after FDR",
    period: "2001-01 to 2025-12",
    plain: "About +0.31 °C per decade",
  },
  signal: { state: "rising", fdr: true, unreliable: true },
  expanded: false,
  onExpand: noop,
  onToggle: noop,
  onOpacity: noop,
  view: { kind: "none" },
  onView: noop,
};

function render(props: Partial<LayerRowProps> = {}): string {
  return renderToStaticMarkup(createElement(LayerRow, { ...base, ...props }));
}

describe("a folded layer row", () => {
  it("shows the value and a folded expand button, without the details", () => {
    const html = render();
    expect(html).toContain("28.0 °C");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Rising 0.31 °C per decade");
    expect(html).not.toContain("Close-up");
    expect(html).not.toContain('role="slider"');
  });

  it("wraps a long name instead of cutting it off", () => {
    const html = render();
    expect(html).toContain("Near-surface air temperature");
    expect(html).not.toContain("truncate");
    expect(html).not.toContain("text-ellipsis");
  });
});

describe("the caution mark", () => {
  it("is on the folded line of a layer whose trend has a caution, with a one-sentence hint", () => {
    const html = render();
    expect(html).toContain("⚠");
    expect(html).toContain(
      "Known data issue: open this layer to read the caution.",
    );
  });

  it("is absent for a layer without a caution", () => {
    const html = render({
      layer: layer("imerg_precip"),
      control: { id: "imerg_precip", visible: true, opacity: 0.8 },
      signal: { state: "not-significant", fdr: false },
    });
    expect(html).not.toContain("⚠");
  });
});

describe("the on/off switch", () => {
  it("is a switch outside the expand button, so turning it on never opens the details", () => {
    const html = render();
    const trigger = html.slice(
      html.indexOf('aria-expanded="false"') - 120,
      html.indexOf("</button>", html.indexOf('aria-expanded="false"')),
    );
    expect(trigger).not.toContain('role="switch"');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('aria-label="Show Near-surface air temperature');
  });
});

describe("the Layers panel", () => {
  const panel = () =>
    renderToStaticMarkup(
      createElement(LayerPanel, {
        layers: [layer("imerg_precip"), layer("gldas_tair")],
        controls: [
          { id: "imerg_precip", visible: true, opacity: 0.8 },
          { id: "gldas_tair", visible: false, opacity: 0.8 },
        ],
        readings: { imerg_precip: "0.32 mm/hr", gldas_tair: "28.0 °C" },
        locationName: "Taichung",
        trends: { gldas_tair: base.trend ?? null },
        view: { kind: "none" },
        onView: noop,
        onToggle: noop,
        onOpacity: noop,
        onHowTo: noop,
      }),
    );

  it("keeps the how-to link without the explanatory paragraph", () => {
    const html = panel();
    expect(html).toContain("How to read this");
    expect(html).not.toContain("Each layer is one measurement at this place");
  });

  it("starts with every layer folded", () => {
    const html = panel();
    expect(html.match(/aria-expanded="false"/g)?.length).toBeGreaterThanOrEqual(
      2,
    );
    expect(html).not.toContain('role="slider"');
  });

  it("has no second month slider; the month is chosen on the timeline", () => {
    const html = panel();
    expect(html).not.toContain("Month");
    expect(html).not.toContain('type="range"');
  });

  it("groups the layers by stratum, top of the atmosphere first", () => {
    const html = panel();
    expect(html).toContain("Troposphere: water vapor and rain");
    expect(html).toContain("Near-surface air");
    expect(html.indexOf("Troposphere: water vapor and rain")).toBeLessThan(
      html.indexOf("Near-surface air"),
    );
  });

  it("keeps the display settings folded, so the layer list stays on the first screen", () => {
    const html = panel();
    expect(html).toContain("Display");
    expect(html).not.toContain("Calm");
  });

  it("keeps only the how-to link above the rows in researcher mode", () => {
    setRole("researcher");
    try {
      const html = panel();
      expect(html).toContain("How to read this");
      expect(html).not.toContain("Trend: linear change");
    } finally {
      setRole("everyone");
    }
  });
});

describe("an open layer row", () => {
  it("shows the trend, the caution, the view choices and the opacity slider in the region the button controls", () => {
    const html = render({ expanded: true });
    expect(html).toContain('aria-expanded="true"');
    const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(controls).toBeTruthy();
    const body = html.slice(html.indexOf(`id="${controls}"`));
    expect(body).toContain("Rising 0.31 °C per decade");
    expect(body).toContain("Caution:");
    expect(body).toContain("Opacity");
    expect(body).toContain('role="slider"');
    expect(body).toContain('role="radiogroup"');
  });

  it("offers Off, Close-up and Chart as radio buttons, Off selected when nothing is open", () => {
    const html = render({ expanded: true });
    expect(html.match(/role="radio"/g)?.length).toBe(3);
    expect(html).toContain("Show on the left");
    expect(html).toContain("Off");
    expect(html).toContain("Close-up");
    expect(html).toContain("Chart");
    expect(html.match(/aria-checked="true"/g)?.filter(Boolean).length).toBe(1);
    expect(html).toMatch(
      /value="off"[^>]*aria-checked="true"|aria-checked="true"[^>]*value="off"/,
    );
  });

  it("selects the choice of the layer that holds the left side, and Off for the others", () => {
    const own = render({
      expanded: true,
      view: { kind: "chart", id: "gldas_tair" },
    });
    expect(own).toMatch(
      /aria-checked="true"[^>]*value="chart"|value="chart"[^>]*aria-checked="true"/,
    );
    const other = render({
      expanded: true,
      view: { kind: "closeup", id: "imerg_precip" },
    });
    expect(other).toMatch(
      /value="off"[^>]*aria-checked="true"|aria-checked="true"[^>]*value="off"/,
    );
    expect(other).not.toMatch(/value="closeup"[^>]*aria-checked="true"/);
  });
});
