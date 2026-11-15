import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RightSidebar } from "./RightSidebar";

describe("the right sidebar", () => {
  const html = () =>
    renderToStaticMarkup(
      createElement(RightSidebar, null, createElement("p", null, "inside")),
    );

  it("has a handle that names the panel it opens and says whether it is open", () => {
    const markup = html();
    expect(markup).toContain('aria-controls="right-sidebar-panel"');
    expect(markup).toContain('id="right-sidebar-panel"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Close layers and companions");
  });

  it("holds what it is given", () => {
    expect(html()).toContain("<p>inside</p>");
  });

  it("slides with a transform and not with display, so it can animate", () => {
    const markup = html();
    expect(markup).toContain("translate-x-0");
    expect(markup).toContain("transition-transform");
  });
});
