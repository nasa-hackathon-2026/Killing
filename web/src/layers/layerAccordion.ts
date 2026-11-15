// The Layers panel opens one layer's details at a time. Choosing a layer
// opens it and closes the one that was open; choosing the open layer again
// closes it.
export function nextExpanded(
  current: string | null,
  chosen: string,
): string | null {
  return current === chosen ? null : chosen;
}
