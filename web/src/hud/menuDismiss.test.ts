import { describe, expect, it } from "vitest";
import { menuDismiss } from "./menuDismiss";

describe("menuDismiss", () => {
  it("closes an open menu on an outside pointer or Escape", () => {
    expect(menuDismiss("outside", true)).toBe("close");
    expect(menuDismiss("escape", true)).toBe("close");
  });

  it("keeps the menu when the pointer is on an option or it is already closed", () => {
    expect(menuDismiss("inside", true)).toBe("keep");
    expect(menuDismiss("outside", false)).toBe("keep");
    expect(menuDismiss("escape", false)).toBe("keep");
  });
});
