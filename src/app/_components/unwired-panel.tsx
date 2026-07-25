import { Cable, Database, ShieldAlert } from 'lucide-react'

export interface UnwiredPanelProps {
  title: string
  description: string
  /** 未来接线后该页读取的真实数据来源，用领域实体名，不写假字段。 */
  sources: readonly string[]
  /** 未来进入该页的前置条件。 */
  futureGuard?: string
}

/**
 * 未接线占位面板（C 层组合）。
 *
 * 唯一被批准的「这页还没做」表面：明确声明未接线，并只列出未来的真实
 * 数据来源。禁止在此渲染假百分比、假状态、假审批结果或可点击无行为的按钮
 * （AGENTS.md §6）。
 */
export function UnwiredPanel({
  title,
  description,
  sources,
  futureGuard,
}: UnwiredPanelProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-ds-border bg-ds-surface text-ds-text shadow-[var(--ds-shadow)] backdrop-blur-xl">
      <header className="flex items-start gap-3 border-b border-ds-border p-5 sm:p-6">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-ds-blue-soft text-ds-blue">
          <Cable aria-hidden className="size-5" />
        </span>
        <div>
          <p className="font-mono text-[9px] tracking-[0.14em] text-ds-text-muted uppercase">
            Route placeholder
          </p>
          <h2 className="mt-1 text-xl font-bold">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ds-text-muted">
            {description}
          </p>
        </div>
      </header>
      <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.7fr)]">
        <div>
          <div className="rounded-md border border-dashed border-ds-blue bg-ds-blue-soft px-4 py-3 text-sm font-semibold text-ds-blue">
            该页尚未接线
          </div>
          {futureGuard ? (
            <div className="mt-4 flex items-start gap-2.5 text-sm text-ds-text-muted">
              <ShieldAlert
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-ds-blue"
              />
              <p>
                <span className="font-semibold text-ds-text">
                  未来进入前置：
                </span>
                {futureGuard}
              </p>
            </div>
          ) : null}
        </div>
        <div className="rounded-md bg-ds-surface-muted p-4">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-ds-text-muted uppercase">
            <Database aria-hidden className="size-4" />
            未来数据来源
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="未来数据来源">
            {sources.map((source) => (
              <li
                key={source}
                className="rounded-md border border-ds-border bg-ds-surface px-2.5 py-1.5 font-mono text-[10px]"
              >
                {source}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
