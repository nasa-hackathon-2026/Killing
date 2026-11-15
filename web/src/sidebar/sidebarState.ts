// Whether the right sidebar (layers and companions) starts open. Pure.

export const SIDEBAR_STORAGE_KEY = "estd.sidebar.open";

// Above this width the sidebar starts open; at or below it, closed (it would
// cover the globe).
export const SIDEBAR_WIDE_WIDTH = 1180;

// A choice the reader made earlier wins; else a link that sets the view
// (?layers=, ?chart=, …) opens it, so the layers it asks for can be seen;
// else the width decides.
export function initialSidebarOpen(input: {
  stored: boolean | null;
  hasViewParams: boolean;
  width: number;
}): boolean {
  if (input.stored !== null) return input.stored;
  if (input.hasViewParams) return true;
  return input.width > SIDEBAR_WIDE_WIDTH;
}
