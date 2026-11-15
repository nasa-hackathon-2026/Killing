import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

export const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md border text-xs leading-none no-underline transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        outline: "border-line bg-panel text-ink hover:bg-hover",
        ghost: "border-transparent bg-transparent text-ink hover:bg-hover",
        pressed: "border-accent bg-accent/25 text-ink",
      },
      size: {
        sm: "h-7 px-2.5",
        icon: "size-7",
      },
    },
    defaultVariants: { variant: "outline", size: "sm" },
  },
);

// The same look on a link, for "Compare with station".
export function buttonClass(
  options: VariantProps<typeof button> = {},
  className?: string,
): string {
  return cn(button(options), className);
}
