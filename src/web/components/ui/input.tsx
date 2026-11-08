import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  type,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-sm border border-input bg-card px-3.5 text-[15px] text-ink shadow-xs outline-none transition-[border-color,box-shadow] duration-[var(--dur-fast)] placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-brand-700 focus-visible:shadow-[var(--focus-ring)]",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
