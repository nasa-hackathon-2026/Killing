import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../lib/cn";

type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  // Colour of the track when on (a layer's own colour).
  color?: string;
};

// shadcn/ui's Switch (Radix Switch + Tailwind): a 32 × 18 px track and a
// 16 px thumb that slides by its own width less 2 px. `p-0` matters: without
// Tailwind's preflight a <button> keeps the browser's own `padding: 1px 6px`,
// which pushed the thumb off the track and cut it (#207). The track colour
// when on is `--switch-on`, the layer's colour.
export function Switch({ className, color, style, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0 shadow-xs transition-colors outline-none",
        "bg-white/25 data-[state=checked]:bg-[var(--switch-on,var(--color-accent))]",
        "focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-panel-solid",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{ ...style, "--switch-on": color } as CSSProperties}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-ink ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=checked]:bg-on-accent data-[state=unchecked]:translate-x-0 motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  );
}
