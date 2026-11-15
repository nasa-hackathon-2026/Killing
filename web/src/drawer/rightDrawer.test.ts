import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DRAWER_ID, RightDrawer } from "./RightDrawer";

const noop = () => {};

function render(open: boolean): string {
  return renderToStaticMarkup(
    createElement(
      RightDrawer,
      { open, onOpenChange: noop },
      createElement("p", null, "inside"),
    ),
  );
}

function handle(html: string): string {
  const start = html.indexOf("<button");
  return html.slice(start, html.indexOf("</button>", start));
}

describe("the right drawer's handle", () => {
  it("points into the page and says the drawer is closed while it is closed", () => {
    const button = handle(render(false));
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain(`aria-controls="${DRAWER_ID}"`);
    expect(button).toContain('title="Layers and statistics"');
    expect(button).toContain('aria-label="Open layers and statistics"');
    expect(button).toContain("&lt;");
  });

  it("points back out and says the drawer is open while it is open", () => {
    const button = handle(render(true));
    expect(button).toContain('aria-expanded="true"');
    expect(button).toContain('aria-label="Close layers and statistics"');
    expect(button).toContain("&gt;");
  });
});

describe("the drawer", () => {
  it("holds its content under the id the handle controls", () => {
    const html = render(true);
    expect(html).toContain(`id="${DRAWER_ID}"`);
    expect(html).toContain("inside");
  });

  it("takes its content out of the tab order while closed", () => {
    expect(render(false)).toMatch(/id="right-drawer"[^>]*inert/);
    expect(render(true)).not.toMatch(/id="right-drawer"[^>]*inert/);
  });
});
