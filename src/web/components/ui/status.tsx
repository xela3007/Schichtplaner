import type * as React from "react";
import { cn } from "@/lib/utils";

const DOT = {
  ok: "bg-success",
  warn: "bg-warning",
  error: "bg-destructive",
} as const;

/**
 * Coloured dot + dark text. The colour carries no text, so the light
 * success/warning tokens stay readable (WCAG AA) — the word says the status.
 */
export function Status({
  tone,
  children,
  className,
}: {
  tone: keyof typeof DOT;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <span
        aria-hidden="true"
        className={cn("size-2.5 rounded-full", DOT[tone])}
      />
      {children}
    </span>
  );
}
