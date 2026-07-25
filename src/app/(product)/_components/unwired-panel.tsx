import { Cable, Database, ShieldAlert } from "lucide-react";

export function UnwiredPanel({
  title,
  description,
  sources,
  futureGuard,
}: {
  title: string;
  description: string;
  sources: readonly string[];
  futureGuard?: string;
}) {
  return (
    <section className="border-ds-border bg-ds-surface text-ds-text overflow-hidden rounded-lg border shadow-[var(--ds-shadow)] backdrop-blur-xl">
      <header className="border-ds-border flex items-start gap-3 border-b p-5 sm:p-6">
        <span className="bg-ds-blue-soft text-ds-blue flex size-10 shrink-0 items-center justify-center rounded-md">
          <Cable aria-hidden className="size-5" />
        </span>
        <div>
          <p className="text-ds-text-muted font-mono text-[9px] tracking-[0.14em] uppercase">
            Stage A route shell
          </p>
          <h2 className="mt-1 text-xl font-bold">{title}</h2>
          <p className="text-ds-text-muted mt-2 max-w-2xl text-sm leading-6">
            {description}
          </p>
        </div>
      </header>
      <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div>
          <div className="border-ds-blue bg-ds-blue-soft text-ds-blue rounded-md border border-dashed px-4 py-3 text-sm font-semibold">
            该页尚未接线（Stage B）
          </div>
          {futureGuard ? (
            <div className="text-ds-text-muted mt-4 flex items-start gap-2.5 text-sm">
              <ShieldAlert
                aria-hidden
                className="text-ds-blue mt-0.5 size-4 shrink-0"
              />
              <p>
                <span className="text-ds-text font-semibold">
                  未来进入前置：
                </span>
                {futureGuard}
              </p>
            </div>
          ) : null}
        </div>
        <div className="bg-ds-surface-muted rounded-md p-4">
          <div className="text-ds-text-muted mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] uppercase">
            <Database aria-hidden className="size-4" />
            未来数据来源
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="未来数据来源">
            {sources.map((source) => (
              <li
                key={source}
                className="border-ds-border bg-ds-surface rounded-md border px-2.5 py-1.5 font-mono text-[10px]"
              >
                {source}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
