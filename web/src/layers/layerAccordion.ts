// The Layers panel lets any number of layers have their details open, so two
// layers can be compared side by side. Choosing a layer opens it if it is
// closed and closes it if it is open; the other layers are left as they are.
export function toggleExpanded(
  current: ReadonlySet<string>,
  chosen: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(chosen)) next.delete(chosen);
  else next.add(chosen);
  return next;
}
