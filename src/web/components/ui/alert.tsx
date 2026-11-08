import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Tinted fill + coloured hairline; text stays in --ink for WCAG AA
// (success/warning tokens are too light for small text on white).
const alertVariants = cva(
  "relative w-full rounded-md border px-4 py-3 text-sm text-ink",
  {
    variants: {
      variant: {
        default: "border-border bg-card",
        destructive: "border-destructive/40 bg-destructive-100",
        success: "border-success/40 bg-success-100",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-semibold", className)}
      {...props}
    />
  );
}

export function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("mt-1 text-sm leading-normal", className)}
      {...props}
    />
  );
}
