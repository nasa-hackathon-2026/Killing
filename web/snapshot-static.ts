import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const cwd =
  (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ??
  dirname(fileURLToPath((import.meta as { url: string }).url));
const GRID_FILES = [
  "meta.json",
  "monthly_climatology.i16",
  "trend_slope_per_decade.i16",
  "trend_significance.u8",
];

function isGridFile(path: string): boolean {
  return GRID_FILES.includes(path.split(sep).at(-1) ?? "");
}

// Static data folders served in dev and copied into dist: the snapshot, the
// analysis results derived from it (trend statistics, mining) and the
// per-cell trend maps of the global grids.
const mounts: {
  name: string;
  dir: string;
  prefix: string;
  only?: (path: string) => boolean;
}[] = [
  { name: "snapshot" },
  { name: "analysis" },
  { name: "grid", only: isGridFile },
].map((mount) => ({
  ...mount,
  dir: resolve(cwd, `../data/${mount.name}`),
  prefix: `/earth-system-trend-detective/data/${mount.name}/`,
}));

function fileFor(url: string): string | null {
  const pathname = decodeURIComponent(url.split("?")[0] ?? "");
  for (const { dir, prefix, only } of mounts) {
    if (!pathname.startsWith(prefix)) continue;
    const file = resolve(dir, pathname.slice(prefix.length));
    if (file !== dir && !file.startsWith(`${dir}${sep}`)) return null;
    if (only && !only(file)) return null;
    return file;
  }
  return null;
}

export function snapshotStatic(): Plugin {
  return {
    name: "snapshot-static",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestUrl = (request as { url?: string }).url;
        if (!requestUrl) return next();
        const file = fileFor(requestUrl);
        if (!file) return next();
        if (!existsSync(file) || !statSync(file).isFile()) {
          response.statusCode = 404;
          response.end("missing data file");
          return;
        }
        response.setHeader(
          "Content-Type",
          file.endsWith(".json")
            ? "application/json; charset=utf-8"
            : "application/octet-stream",
        );
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      for (const { name, dir, only } of mounts) {
        if (!existsSync(dir)) continue;
        cpSync(dir, resolve(cwd, `dist/data/${name}`), {
          recursive: true,
          // Directories pass so the copy can descend into them.
          filter: (source) =>
            !only || statSync(source).isDirectory() || only(source),
        });
      }
    },
  };
}
