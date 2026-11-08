import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Small tinted label (Dinexis "Pill"): border + tint fill, text in ink tones.
const pillVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-caption font-semibold leading-5",
  {
    variants: {
      variant: {
        neutral: "border-border-strong bg-paper-2 text-ink-2",
        brand: "border-brand/50 bg-brand-050 text-brand-700",
        accent: "border-magenta/40 bg-magenta-100 text-ink",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Pill({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof pillVariants>) {
  return (
    <span
      data-slot="pill"
      className={cn(pillVariants({ variant }), className)}
      {...props}
    />
  );
}
