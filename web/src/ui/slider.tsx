import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn";

// A single-value slider (Radix Slider): arrow, Home, End and Page keys and
// the aria attributes come from the primitive.
type SliderProps = Omit<
  ComponentProps<typeof SliderPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange"
> & {
  value: number;
  onValueChange: (value: number) => void;
};

export function Slider({
  className,
  value,
  onValueChange,
  ...rest
}: SliderProps) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex h-5 w-full touch-none items-center select-none",
        className,
      )}
      value={[value]}
      onValueChange={(next) => onValueChange(next[0] ?? value)}
      {...rest}
    >
      <SliderPrimitive.Track className="relative h-1 grow rounded-full bg-white/25">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block size-3.5 rounded-full border-2 border-accent bg-ink shadow" />
    </SliderPrimitive.Root>
  );
}
