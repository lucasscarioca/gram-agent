import type { HTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-[color:var(--border)] bg-[rgba(255,255,255,0.03)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-[var(--muted-foreground)]",
        className,
      )}
      {...props}
    />
  );
}
