import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Joins class names and lets a later Tailwind utility replace an earlier one
// (`cn("px-2", "px-4")` is `px-4`). The one helper the components in ui/ use.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
