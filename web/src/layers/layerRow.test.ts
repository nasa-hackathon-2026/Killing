import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
  onCloseUp: noop,
  onChart: noop,
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
    expect(html).not.toContain('type="range"');
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

describe("the on/off box", () => {
  it("is outside the expand button, so ticking it never opens the details", () => {
    const html = render();
    const button = html.slice(
      html.indexOf('<button type="button" class="layer-row-toggle"'),
      html.indexOf("</button>"),
    );
    expect(button).not.toContain("checkbox");
    expect(html).toContain('type="checkbox"');
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
        months: ["2025-06-01"],
        month: "2025-06-01",
        onMonth: noop,
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
    expect(
      html.match(/class="layer-row-toggle" aria-expanded="false"/g)?.length,
    ).toBe(2);
    expect(html).not.toContain('type="range" min="0.15"');
  });
});

describe("an open layer row", () => {
  it("shows the trend, the caution, the actions and the opacity slider in the region the button controls", () => {
    const html = render({ expanded: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls="layer-details-gldas_tair"');
    const body = html.slice(html.indexOf('id="layer-details-gldas_tair"'));
    expect(body).toContain("Rising 0.31 °C per decade");
    expect(body).toContain("Caution:");
    expect(body).toContain("Details");
    expect(body).toContain("Close-up");
    expect(body).toContain("Chart");
    expect(body).toContain('type="range"');
  });
});
