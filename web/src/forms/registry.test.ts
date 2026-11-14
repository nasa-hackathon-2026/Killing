import { describe, expect, it } from "vitest";
import { mockVariables } from "../mock/snapshot";
import { formRegistry } from "./registry";

describe("formRegistry", () => {
  it("lists the two designed forms and their variables", () => {
    expect(formRegistry.map((form) => form.id)).toEqual([
      "water-droplet",
      "round-air",
    ]);
    expect(formRegistry.map((form) => form.variableId)).toEqual([
      "imerg_precip",
      "omi_no2",
    ]);
    const assigned = mockVariables
      .filter((variable) => variable.formId)
      .map((variable) => [variable.id, variable.formId]);
    expect(assigned).toEqual([
      ["imerg_precip", "water-droplet"],
      ["omi_no2", "round-air"],
    ]);
  });
});
