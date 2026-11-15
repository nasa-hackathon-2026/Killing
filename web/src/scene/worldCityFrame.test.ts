import { describe, expect, it } from "vitest";
import { worldCityFrame } from "./worldCityFrame";

const london = { group: "world_city", lat: 51.51, lon: -0.13 };

describe("worldCityFrame", () => {
  it("puts a world city on the viewing axis at the given distance", () => {
    expect(worldCityFrame(london, 2.3)).toEqual({
      lat: 51.51,
      lon: -0.13,
      distance: 2.3,
    });
  });

  it("does not frame Taiwan, the global mean, or a place without coordinates", () => {
    expect(
      worldCityFrame({ group: "taiwan", lat: 24.15, lon: 120.67 }, 2.3),
    ).toBeNull();
    expect(
      worldCityFrame({ group: "global", lat: null, lon: null }, 2.3),
    ).toBeNull();
    expect(
      worldCityFrame({ group: "world_city", lat: null, lon: null }, 2.3),
    ).toBeNull();
    expect(worldCityFrame(null, 2.3)).toBeNull();
    expect(worldCityFrame(undefined, 2.3)).toBeNull();
  });

  it("rejects a distance that is not a slight zoom", () => {
    expect(worldCityFrame(london, 0)).toBeNull();
    expect(worldCityFrame(london, Number.NaN)).toBeNull();
  });
});
