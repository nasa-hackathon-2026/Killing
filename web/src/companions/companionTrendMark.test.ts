import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Companion } from "./Companion";

function mark(signal: {
  state: "rising" | "falling" | "not-significant" | "insufficient";
  fdr: boolean;
  unreliable?: boolean;
}): string {
  const html = renderToStaticMarkup(
    createElement(Companion, {
      variableId: "merra2_t2m",
      value: 0.5,
      signal,
      size: 80,
    }),
  );
  const start = html.indexOf('<g class="companion-trend">');
  return html.slice(start, html.indexOf("</g>", start) + 4);
}

describe("the mark over a companion's head", () => {
  it("carries the Layers panel's words as its tooltip", () => {
    expect(mark({ state: "rising", fdr: true })).toContain(
      "<title>Rising</title>",
    );
    expect(mark({ state: "falling", fdr: true })).toContain(
      "<title>Falling</title>",
    );
    expect(mark({ state: "not-significant", fdr: false })).toContain(
      "<title>No clear change in this record</title>",
    );
  });

  it("reacts to the pointer over its whole area, hollow shapes included", () => {
    for (const state of ["rising", "not-significant"] as const) {
      expect(mark({ state, fdr: false })).toContain(
        'class="companion-trend-hit"',
      );
    }
  });
});
