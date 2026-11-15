import { describe, expect, it } from "vitest";
import {
  DRAWER_STORAGE_KEY,
  drawerOpenAtStart,
  nextOpenOnKey,
  rememberDrawerOpen,
  storedDrawerOpen,
} from "./drawerState";

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("whether the drawer starts open", () => {
  it("opens on a wide screen and stays closed on a narrow one", () => {
    expect(drawerOpenAtStart({ width: 1440, stored: null, search: "" })).toBe(
      true,
    );
    expect(drawerOpenAtStart({ width: 1180, stored: null, search: "" })).toBe(
      false,
    );
    expect(drawerOpenAtStart({ width: 390, stored: null, search: "" })).toBe(
      false,
    );
  });

  it("follows the visitor's last choice over the screen width", () => {
    expect(drawerOpenAtStart({ width: 1440, stored: false, search: "" })).toBe(
      false,
    );
    expect(drawerOpenAtStart({ width: 390, stored: true, search: "" })).toBe(
      true,
    );
  });

  it("opens when the address sets the view, whatever was stored", () => {
    expect(
      drawerOpenAtStart({ width: 390, stored: false, search: "?layers=x" }),
    ).toBe(true);
    expect(
      drawerOpenAtStart({ width: 1440, stored: false, search: "?trendmap=y" }),
    ).toBe(true);
  });
});

describe("the remembered choice", () => {
  it("reads back what was written", () => {
    const store = memoryStore();
    expect(storedDrawerOpen(store)).toBeNull();
    rememberDrawerOpen(false, store);
    expect(store.data[DRAWER_STORAGE_KEY]).toBe("0");
    expect(storedDrawerOpen(store)).toBe(false);
    rememberDrawerOpen(true, store);
    expect(storedDrawerOpen(store)).toBe(true);
  });

  it("is unknown, and writing is skipped, when storage is blocked or missing", () => {
    expect(storedDrawerOpen(throwing)).toBeNull();
    expect(() => rememberDrawerOpen(true, throwing)).not.toThrow();
    expect(storedDrawerOpen(null)).toBeNull();
    expect(storedDrawerOpen(memoryStore({ [DRAWER_STORAGE_KEY]: "x" }))).toBe(
      null,
    );
  });
});

describe("keys", () => {
  it("closes an open drawer on Escape and leaves everything else alone", () => {
    expect(nextOpenOnKey(true, "Escape")).toBe(false);
    expect(nextOpenOnKey(false, "Escape")).toBe(false);
    expect(nextOpenOnKey(true, "Enter")).toBe(true);
  });
});
