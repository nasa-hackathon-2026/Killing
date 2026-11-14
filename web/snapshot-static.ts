import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const cwd =
  (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ??
  dirname(fileURLToPath((import.meta as { url: string }).url));
// Static data folders served in dev and copied into dist: the snapshot and
// the analysis results derived from it (trend statistics, mining).
const mounts = ["snapshot", "analysis"].map((name) => ({
  name,
  dir: resolve(cwd, `../data/${name}`),
  prefix: `/earth-system-trend-detective/data/${name}/`,
}));

function fileFor(url: string): string | null {
  const pathname = decodeURIComponent(url.split("?")[0] ?? "");
  for (const { dir, prefix } of mounts) {
    if (!pathname.startsWith(prefix)) continue;
    const file = resolve(dir, pathname.slice(prefix.length));
    if (file !== dir && !file.startsWith(`${dir}${sep}`)) return null;
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
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      for (const { name, dir } of mounts) {
        if (!existsSync(dir)) continue;
        cpSync(dir, resolve(cwd, `dist/data/${name}`), { recursive: true });
      }
    },
  };
}
