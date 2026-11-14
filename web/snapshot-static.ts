import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const cwd =
  (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ??
  dirname(fileURLToPath((import.meta as { url: string }).url));
const snapshotDir = resolve(cwd, "../data/snapshot");
const prefix = "/earth-system-trend-detective/data/snapshot/";

function fileFor(url: string): string | null {
  const pathname = decodeURIComponent(url.split("?")[0] ?? "");
  if (!pathname.startsWith(prefix)) return null;
  const relative = pathname.slice(prefix.length);
  const file = resolve(snapshotDir, relative);
  if (file !== snapshotDir && !file.startsWith(`${snapshotDir}${sep}`)) {
    return null;
  }
  return file;
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
          response.end("missing snapshot file");
          return;
        }
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        createReadStream(file).pipe(response);
      });
    },
    closeBundle() {
      cpSync(snapshotDir, resolve(cwd, "dist/data/snapshot"), {
        recursive: true,
      });
    },
  };
}
