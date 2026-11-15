import { describe, expect, it } from "vitest";
import { searchMenu, type MenuSearchItem } from "./menuSearch";

const items: MenuSearchItem[] = [
  { kind: "place", id: "taipei", label: "Taipei" },
  { kind: "place", id: "taichung", label: "Taichung" },
  { kind: "layer", id: "imerg_precip", label: "Precipitation" },
  { kind: "layer", id: "gldas_soilmoist", label: "Surface soil moisture" },
];

describe("searchMenu", () => {
  it("matches names and ids without caring about case", () => {
    expect(searchMenu("TAI", items).map((item) => item.id)).toEqual([
      "taipei",
      "taichung",
    ]);
    expect(searchMenu("soil", items).map((item) => item.id)).toEqual([
      "gldas_soilmoist",
    ]);
    expect(searchMenu("imerg", items).map((item) => item.id)).toEqual([
      "imerg_precip",
    ]);
  });

  it("returns nothing for a blank query and stops at the limit", () => {
    expect(searchMenu("", items)).toEqual([]);
    expect(searchMenu("   ", items)).toEqual([]);
    expect(searchMenu("t", items, 1).map((item) => item.id)).toEqual([
      "taipei",
    ]);
  });
});
