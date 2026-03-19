import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex w-full flex-wrap items-center gap-2 rounded-lg border border-[color:var(--border)] bg-[var(--panel)] p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex min-w-[84px] items-center justify-center rounded-md px-3 py-2 text-xs font-semibold tracking-[0.14em] text-[var(--muted-foreground)] transition data-[state=active]:bg-[var(--accent)] data-[state=active]:text-[var(--accent-foreground)]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}
