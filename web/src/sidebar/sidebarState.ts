// Whether the right sidebar (layers and companions) starts open. Pure.

export const SIDEBAR_STORAGE_KEY = "estd.sidebar.open";

// Above this width the sidebar starts open; at or below it, closed (it would
// cover the globe).
export const SIDEBAR_WIDE_WIDTH = 1180;

// At or below this width the sidebar covers most of the page.
export const SIDEBAR_PHONE_WIDTH = 700;

// A choice the reader made earlier wins; else a link that sets the view
// (?layers=, ?chart=, …) opens it, so the layers it asks for can be seen,
// except on a phone, where it would cover the chart or the close-up the link
// asks for; else the width decides.
export function initialSidebarOpen(input: {
  stored: boolean | null;
  hasViewParams: boolean;
  width: number;
}): boolean {
  if (input.stored !== null) return input.stored;
  if (input.hasViewParams) return input.width > SIDEBAR_PHONE_WIDTH;
  return input.width > SIDEBAR_WIDE_WIDTH;
}
