export type MenuSearchKind = "place" | "layer";

export type MenuSearchItem = {
  kind: MenuSearchKind;
  id: string;
  label: string;
};

// Places and layers whose visible name or id contains the query.
// Blank input matches nothing, so the menu does not list every entry.
// Matching ignores case. Results keep the order they were given.
export function searchMenu(
  query: string,
  items: readonly MenuSearchItem[],
  limit = Number.POSITIVE_INFINITY,
): MenuSearchItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: MenuSearchItem[] = [];
  for (const item of items) {
    const haystack = `${item.label} ${item.id}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    hits.push(item);
    if (hits.length >= limit) break;
  }
  return hits;
}
