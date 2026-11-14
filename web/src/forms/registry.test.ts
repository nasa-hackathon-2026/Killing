import { describe, expect, it } from "vitest";
import { mockVariables } from "../mock/snapshot";
import { formRegistry } from "./registry";

describe("formRegistry", () => {
  it("keeps the two original forms first, on their variables", () => {
    expect(formRegistry.slice(0, 2).map((form) => form.id)).toEqual([
      "water-droplet",
      "round-air",
    ]);
    expect(formRegistry.slice(0, 2).map((form) => form.variableId)).toEqual([
      "imerg_precip",
      "omi_no2",
    ]);
  });

  it("gives every variable a registered form", () => {
    const ids = formRegistry.map((form) => form.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const variable of mockVariables) {
      expect(ids).toContain(variable.formId);
    }
    for (const form of formRegistry) {
      const example = mockVariables.find(
        (variable) => variable.id === form.variableId,
      );
      expect(example?.formId).toBe(form.id);
    }
  });
});
