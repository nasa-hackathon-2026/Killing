import { describe, expect, it } from "vitest";

// An import such as "./UnitText" tries the extensions in order, so on a
// filesystem that ignores case (Windows, macOS) it finds "unitText.ts" before
// "UnitText.tsx" and the page fails to load, while Linux (CI, the published
// site) resolves it fine. No two modules of a folder may therefore share a
// name that differs only by case.
function stripExt(name: string): string {
  return name.replace(/\.(d\.)?[cm]?[jt]sx?$/, "");
}

// Only the file names are read (nothing is imported).
const files = Object.keys(import.meta.glob("./**/*.{ts,tsx}"));

function collisions(paths: string[]): string[] {
  const byLowerStem = new Map<string, string[]>();
  for (const path of paths) {
    const slash = path.lastIndexOf("/");
    const dir = path.slice(0, slash);
    const stem = stripExt(path.slice(slash + 1));
    const key = `${dir}/${stem.toLowerCase()}`;
    byLowerStem.set(key, [...(byLowerStem.get(key) ?? []), path]);
  }
  // The same name in two spellings: the stems are not identical.
  return [...byLowerStem.values()]
    .filter(
      (group) =>
        new Set(
          group.map((path) => stripExt(path.slice(path.lastIndexOf("/") + 1))),
        ).size > 1,
    )
    .map((group) => group.join(" / "));
}

describe("module names", () => {
  it("finds the modules of the app", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("never differ only by case within a folder", () => {
    expect(collisions(files)).toEqual([]);
  });

  it("would catch a folder that has UnitText.tsx and unitText.ts", () => {
    expect(
      collisions(["./a/UnitText.tsx", "./a/unitText.ts", "./a/other.ts"]),
    ).toEqual(["./a/UnitText.tsx / ./a/unitText.ts"]);
    expect(
      collisions(["./a/Foo.tsx", "./b/foo.ts", "./a/Foo.test.ts"]),
    ).toEqual([]);
  });
});
