export type MenuPointer = "inside" | "outside" | "escape";

// An open custom menu closes on a pointer outside it or on Escape.
// A pointer on an option keeps it open; a closed menu stays closed.
export function menuDismiss(
  where: MenuPointer,
  open: boolean,
): "close" | "keep" {
  if (!open || where === "inside") return "keep";
  return "close";
}
