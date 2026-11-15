import { describe, expect, it } from "vitest";
import { initialSidebarOpen, SIDEBAR_WIDE_WIDTH } from "./sidebarState";

const base = { stored: null, hasViewParams: false, width: 1440 };

describe("initialSidebarOpen", () => {
  it("starts open on a wide screen and closed on a narrow one", () => {
    expect(initialSidebarOpen(base)).toBe(true);
    expect(initialSidebarOpen({ ...base, width: SIDEBAR_WIDE_WIDTH })).toBe(
      false,
    );
    expect(initialSidebarOpen({ ...base, width: 390 })).toBe(false);
  });

  it("opens for a link that sets the view, even on a narrow screen", () => {
    expect(
      initialSidebarOpen({ ...base, hasViewParams: true, width: 390 }),
    ).toBe(true);
  });

  it("keeps what the reader chose before, over everything else", () => {
    expect(initialSidebarOpen({ ...base, stored: false })).toBe(false);
    expect(initialSidebarOpen({ ...base, stored: true, width: 390 })).toBe(
      true,
    );
    expect(
      initialSidebarOpen({ ...base, stored: false, hasViewParams: true }),
    ).toBe(false);
  });
});
