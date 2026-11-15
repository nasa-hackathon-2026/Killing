import type { MessageTree } from "./core";

// { "./locales/en/layers.json": {...} } -> { layers: {...} }. Files whose
// name starts with "_" hold notes for translators, not messages.
export function namespacesOf(
  files: Record<string, MessageTree>,
): Record<string, MessageTree> {
  const result: Record<string, MessageTree> = {};
  for (const [path, tree] of Object.entries(files)) {
    const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
    if (!name.startsWith("_")) result[name] = tree;
  }
  return result;
}
