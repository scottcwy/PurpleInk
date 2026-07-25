import type { ReactNode } from "react";

export function ProductPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-ds-border bg-ds-surface flex min-h-16 flex-wrap items-center justify-between gap-3 border-b px-5 backdrop-blur-xl sm:px-8">
      <div>
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-ds-text-muted mt-0.5 font-mono text-[11px]">
          {subtitle}
        </p>
      </div>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}
