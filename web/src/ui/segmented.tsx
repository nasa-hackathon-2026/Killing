import * as RadioGroup from "@radix-ui/react-radio-group";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  // Spoken name of this choice, when the label alone is not enough.
  ariaLabel?: string;
};

type SegmentedProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  "aria-label": string;
  className?: string;
};

// A radio group drawn as one segmented control (shadcn/ui's RadioGroup on
// Radix): exactly one choice is selected, the arrow keys move the choice, and
// Tab enters and leaves the group once.
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={rest["aria-label"]}
      className={cn(
        "inline-flex gap-0.5 rounded-md border border-line bg-panel p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <RadioGroup.Item
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          className={cn(
            "h-6 cursor-pointer rounded px-2.5 text-xs leading-none text-muted transition-colors",
            "border border-transparent bg-transparent hover:text-ink",
            "data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/25 data-[state=checked]:text-ink",
          )}
        >
          {option.label}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
