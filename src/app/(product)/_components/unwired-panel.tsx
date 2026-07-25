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
    <section className="relative overflow-hidden rounded-[28px] border border-[#d9d1c4] bg-[#fffdf8] p-6 shadow-[0_18px_60px_rgba(45,36,26,0.08)] dark:border-white/10 dark:bg-[#1d1b18] sm:p-8">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-[#e75c3c]" />
      <div className="flex flex-col gap-6">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#fbe2da] text-[#b43b22] dark:bg-[#e75c3c]/15 dark:text-[#ff8d74]">
            <Cable aria-hidden className="size-5" />
          </span>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#8b6255] dark:text-[#d89987]">
              Stage A route shell
            </p>
            <h2 className="mt-2 font-serif text-3xl leading-tight text-[#171511] dark:text-[#f5efe6]">
              {title}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#655f56] dark:text-[#bbb2a6]">
              {description}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-[#ca9c8f] bg-[#fff7f3] px-4 py-3 text-sm font-semibold text-[#8d2f1d] dark:border-[#e75c3c]/40 dark:bg-[#e75c3c]/8 dark:text-[#ff9f8b]">
          该页尚未接线（Stage B）
        </div>

        {futureGuard ? (
          <div className="flex items-start gap-3 text-sm text-[#655f56] dark:text-[#bbb2a6]">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-[#b43b22] dark:text-[#ff8d74]" />
            <p>
              <span className="font-semibold text-[#28231d] dark:text-[#eee7dc]">
                未来进入前置：
              </span>
              {futureGuard}
            </p>
          </div>
        ) : null}

        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#7a7166] dark:text-[#9f968b]">
            <Database aria-hidden className="size-4" />
            未来数据来源
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="未来数据来源">
            {sources.map((source) => (
              <li
                key={source}
                className="rounded-full border border-[#ddd4c7] bg-[#f5f0e8] px-3 py-1.5 font-mono text-xs text-[#3e3932] dark:border-white/10 dark:bg-white/5 dark:text-[#ddd4c8]"
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
