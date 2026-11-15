// Checks the message files (src/i18n/locales/<lang>/<namespace>.json):
// every language has the same namespaces and the same keys as English, the
// same {{placeholders}} in every message, and no empty string; every English
// key has a translator note in en/_context.json (by longest key prefix).
//
//   node scripts/check-locales.mjs          check, exit 1 on a problem
//   node scripts/check-locales.mjs --sync   first copy missing files and
//                                           keys from English (the value is
//                                           the English text, to translate)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/i18n/locales",
);
const BASE = "en";
const sync = process.argv.includes("--sync");

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const namespacesOf = (lang) =>
  readdirSync(join(root, lang))
    .filter((file) => file.endsWith(".json") && !file.startsWith("_"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();

function flatten(tree, prefix, into = new Map()) {
  for (const [key, value] of Object.entries(tree)) {
    const path = `${prefix}.${key}`;
    if (typeof value === "string") into.set(path, value);
    else flatten(value, path, into);
  }
  return into;
}

// `source` with the values `target` already has; keys keep English order.
function merged(source, target) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const existing = target?.[key];
    if (typeof value === "string") {
      result[key] = typeof existing === "string" ? existing : value;
    } else {
      result[key] = merged(
        value,
        existing && typeof existing === "object" ? existing : {},
      );
    }
  }
  return result;
}

const placeholders = (text) =>
  [...text.matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");

const languages = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const namespaces = namespacesOf(BASE);
const problems = [];
const counts = {};

if (sync) {
  for (const lang of languages) {
    if (lang === BASE) continue;
    for (const namespace of namespaces) {
      const path = join(root, lang, `${namespace}.json`);
      let existing = {};
      try {
        existing = read(path);
      } catch {
        // New file.
      }
      const next = merged(
        read(join(root, BASE, `${namespace}.json`)),
        existing,
      );
      writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    }
  }
}

const context = flatten(read(join(root, BASE, "_context.json")), "").size
  ? read(join(root, BASE, "_context.json"))
  : {};
const hasContext = (key) => {
  let prefix = key;
  while (prefix) {
    if (typeof context[prefix] === "string" && context[prefix]) return true;
    const cut = prefix.lastIndexOf(".");
    if (cut < 0) return false;
    prefix = prefix.slice(0, cut);
  }
  return false;
};

for (const namespace of namespaces) {
  const base = flatten(read(join(root, BASE, `${namespace}.json`)), namespace);
  counts[namespace] = base.size;
  for (const [key, value] of base) {
    if (value.trim() === "") problems.push(`${BASE}: empty ${key}`);
    if (!hasContext(key))
      problems.push(`${BASE}: no translator note for ${key}`);
  }
  for (const lang of languages) {
    if (lang === BASE) continue;
    let tree;
    try {
      tree = read(join(root, lang, `${namespace}.json`));
    } catch {
      problems.push(`${lang}: missing file ${namespace}.json`);
      continue;
    }
    const other = flatten(tree, namespace);
    for (const [key, value] of base) {
      const text = other.get(key);
      if (text === undefined) problems.push(`${lang}: missing ${key}`);
      else if (text.trim() === "") problems.push(`${lang}: empty ${key}`);
      else if (placeholders(text) !== placeholders(value)) {
        problems.push(`${lang}: placeholders differ in ${key}`);
      }
    }
    for (const key of other.keys()) {
      if (!base.has(key)) problems.push(`${lang}: extra ${key}`);
    }
  }
}
for (const lang of languages) {
  for (const namespace of namespacesOf(lang)) {
    if (!namespaces.includes(namespace)) {
      problems.push(`${lang}: extra file ${namespace}.json`);
    }
  }
}

const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
console.log(
  `${languages.length} languages, ${namespaces.length} namespaces, ${total} keys`,
);
console.log(
  Object.entries(counts)
    .map(([name, count]) => `${name} ${count}`)
    .join(", "),
);
if (problems.length > 0) {
  console.error(problems.slice(0, 60).join("\n"));
  console.error(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log("OK");
