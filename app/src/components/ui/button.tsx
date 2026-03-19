import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg border text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--accent)] px-4 py-2 text-[var(--accent-foreground)] hover:opacity-90",
        ghost: "border-transparent bg-transparent px-3 py-2 text-[var(--muted-foreground)] hover:bg-white/6 hover:text-[var(--foreground)]",
        outline: "border-[color:var(--border)] bg-[var(--panel)] px-4 py-2 text-[var(--foreground)] hover:border-[color:var(--border-strong)] hover:bg-[var(--panel-strong)]",
      },
      size: {
        sm: "h-9 px-3 text-xs",
        default: "h-10 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
