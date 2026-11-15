import { afterEach, describe, expect, it } from "vitest";
import { registerMessages, setLocale } from "../i18n";
import zhMessages from "../i18n/bundles/zh-TW";
import { fieldText } from "./fieldText";

registerMessages("zh-TW", zhMessages);

afterEach(() => setLocale("en"));

describe("global distribution text", () => {
  it("changes wording without changing the displayed facts", () => {
    expect(fieldText.typical("July")).toBe("Typical July");
    setLocale("zh-TW");
    expect(fieldText.typical("7 月")).toBe("典型的 7 月");
    expect(fieldText.method(2001, 2020)).toContain("2001–2020");
  });
});
