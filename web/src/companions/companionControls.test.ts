import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { registerMessages, setLocale } from "../i18n";
import zhCommon from "../i18n/locales/zh-TW/common.json";
import zhCompanions from "../i18n/locales/zh-TW/companions.json";
import { CompanionCaption, CompanionToolbar } from "./CompanionControls";

const noop = () => {};

registerMessages("zh-TW", { common: zhCommon, companions: zhCompanions });

afterEach(() => setLocale("en"));

function toolbar(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(CompanionToolbar, {
      canSpeak: true,
      voiceOn: false,
      narrate: false,
      gathered: false,
      onVoice: noop,
      onNarrate: noop,
      onGather: noop,
      ...overrides,
    }),
  );
}

// The <button> that holds `label` (its text comes right before </button>).
function button(html: string, label: string): string {
  const end = html.indexOf(`${label}</button>`);
  const start = html.lastIndexOf("<button", end);
  return html.slice(start, end + label.length + 9);
}

describe("the companion panel's switches", () => {
  it("are three buttons with fixed names, in one row", () => {
    const html = toolbar();
    expect(html.match(/<button/g)?.length).toBe(3);
    expect(html.match(/class="companion-tools"/g)?.length).toBe(1);
    for (const name of ["Voice", "Guide", "Gather"]) {
      expect(html).toContain(`</svg>${name}</button>`);
    }
  });

  it("say they are off or on through aria-pressed, never in the words", () => {
    const off = toolbar();
    expect(off.match(/aria-pressed="false"/g)?.length).toBe(3);
    const on = toolbar({ voiceOn: true, narrate: true, gathered: true });
    expect(on.match(/aria-pressed="true"/g)?.length).toBe(3);
    expect(on).not.toMatch(/Voice on|Guide on|Voice off|Guide off/);
    expect(button(on, "Voice")).toContain("companion-switch-on");
    expect(button(off, "Voice")).not.toContain("companion-switch-on");
  });

  it("leave out the voice switch where the browser cannot speak", () => {
    const html = toolbar({ canSpeak: false });
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).not.toContain("Voice");
  });

  it("explain the group view in its tooltip", () => {
    expect(button(toolbar(), "Gather")).toContain('title="Group view"');
    setLocale("zh-TW");
    expect(toolbar()).toContain('title="讓所有夥伴排在一起"');
  });
});

describe("under a companion's name", () => {
  const caption = (kind: "satellite_retrieval" | "model" | "in_situ") =>
    renderToStaticMarkup(
      createElement(CompanionCaption, {
        title: "Warmth · MERRA-2",
        reading: "27.1 °C",
        kind,
      }),
    );

  it("stand the month's value with its unit, as the Layers panel writes it", () => {
    const html = caption("model");
    expect(html).toContain("Warmth · MERRA-2");
    expect(html).toContain('<span class="companion-value">27.1 °C</span>');
  });

  it("stands the data source as one small tag", () => {
    expect(caption("satellite_retrieval")).toContain(">Satellite</span>");
    expect(caption("model")).toContain(">Model</span>");
    expect(caption("in_situ")).toContain(">Station</span>");
    expect(caption("model")).toContain("companion-kind");
  });

  it("names the three kinds in Traditional Chinese", () => {
    setLocale("zh-TW");
    expect(caption("satellite_retrieval")).toContain(">衛星</span>");
    expect(caption("model")).toContain(">模式</span>");
    expect(caption("in_situ")).toContain(">測站</span>");
  });
});
