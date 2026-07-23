import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: ReactNode;
};

export function EmptyState({
  icon: Icon,
  title,
  detail,
  action,
}: EmptyStateProps): ReactNode {
  return (
    <section className="border-border bg-muted flex min-h-[22rem] items-center justify-center border border-dashed px-6 py-14 text-center">
      <div className="max-w-sm">
        <span className="border-border bg-background text-accent-strong mx-auto flex size-11 items-center justify-center border">
          <Icon size={20} strokeWidth={1.7} />
        </span>
        <h2 className="mt-5 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">{detail}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </section>
  );
}

export const primaryActionClassName =
  "focus-ring inline-flex h-10 items-center justify-center gap-2 bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:bg-accent";
