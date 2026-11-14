import { describe, expect, it } from "vitest";
import { closeUps } from "../closeup/closeUps";
import { mockVariables } from "../mock/snapshot";
import { formMapping, formSpec, TOTAL_PARTICLE_CAP } from "./formMapping";
import { MAX_FORM_PARTICLES } from "./particleField";
import { formRegistry } from "./registry";

describe("formMapping", () => {
  it("has one row per variable, matching the variable list", () => {
    expect(formMapping.map((row) => row.variableId)).toEqual(
      mockVariables.map((variable) => variable.id),
    );
    for (const variable of mockVariables) {
      expect(formSpec(variable.id)?.formId).toBe(variable.formId);
    }
  });

  it("only names forms and close-ups that exist", () => {
    const forms = formRegistry.map((form) => form.id);
    const views = closeUps.map((view) => view.id);
    for (const row of formMapping) {
      expect(forms).toContain(row.formId);
      expect(views).toContain(row.closeUpId);
    }
  });

  it("keeps every layer within the instance limit", () => {
    for (const row of formMapping) {
      expect(row.encoding.maxCount).toBeLessThanOrEqual(MAX_FORM_PARTICLES);
      expect(row.band[1]).toBeGreaterThan(row.band[0]);
    }
    expect(TOTAL_PARTICLE_CAP).toBeLessThanOrEqual(12 * MAX_FORM_PARTICLES);
  });
});
