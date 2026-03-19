import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(26,34,31,0.96),rgba(18,24,22,0.98))] p-5 shadow-[0_18px_42px_rgba(0,0,0,0.22)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold tracking-[-0.02em] text-[var(--foreground)]", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-[var(--muted-foreground)]", className)} {...props} />;
}
