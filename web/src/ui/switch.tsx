import * as SwitchPrimitive from "@radix-ui/react-switch";
import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../lib/cn";

type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  // Colour of the track when on (a layer's own colour).
  color?: string;
};

// An on/off switch (Radix Switch): keyboard, aria-checked and focus come from
// the primitive; the look is Tailwind.
export function Switch({ className, color, style, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-white/10 transition-colors",
        "data-[state=checked]:border-transparent data-[state=checked]:bg-[var(--switch-on,var(--color-accent))]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{ ...style, "--switch-on": color } as CSSProperties}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[12px] translate-x-[2px] rounded-full bg-ink shadow transition-transform data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-on-accent motion-reduce:transition-none" />
    </SwitchPrimitive.Root>
  );
}
