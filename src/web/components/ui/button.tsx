import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// Dinexis Design System (ADR-011): graphite pill as primary, white pill with
// hairline as secondary, cyan focus ring, calm 140ms transitions.
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold leading-none outline-none transition-[background-color,box-shadow,transform,border-color] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:shadow-[var(--focus-ring)] active:scale-[0.985] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-md hover:bg-primary-hover hover:shadow-lg",
        destructive:
          "bg-destructive text-primary-foreground shadow-md hover:shadow-lg",
        outline:
          "border border-border-strong bg-card text-ink shadow-sm hover:bg-surface-inset",
        secondary:
          "border border-border-strong bg-card text-ink shadow-sm hover:bg-surface-inset",
        ghost: "text-ink-2 hover:bg-surface-inset hover:text-ink",
        link: "rounded-none px-0 text-brand-700 underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-11 px-[22px] text-[15.5px]",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-7 text-[17px]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
