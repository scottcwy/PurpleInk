import Link from "next/link";

const COLORS = [
  ["Surface", "bg-ds-surface"],
  ["Muted", "bg-ds-surface-muted"],
  ["Primary", "bg-ds-primary"],
  ["Blue", "bg-ds-blue"],
  ["Green", "bg-ds-green"],
  ["Red", "bg-ds-red"],
] as const;

const RADII = [
  ["2px", "rounded-sm"],
  ["6px", "rounded-md"],
  ["8px", "rounded-lg"],
  ["999px", "rounded-full"],
] as const;

export default function PlaybookFoundationsPage() {
  return (
    <main className="ds-app-gradient text-ds-text min-h-screen p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/playbook" className="text-ds-text-muted text-sm underline">
          ← 组件手册
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">
          Foundations · 设计 token
        </h1>
        <p className="text-ds-text-muted mt-2 text-sm">
          token 单一真源为 canvas.pen，并在 globals.css 中映射为明暗主题变量。
        </p>

        <section className="border-ds-border bg-ds-surface mt-6 rounded-lg border p-6">
          <h2 className="text-ds-text-muted font-mono text-[11px] font-semibold tracking-wide uppercase">
            色板
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {COLORS.map(([label, color]) => (
              <div key={label} className="flex items-center gap-3">
                <div
                  className={`border-ds-border size-12 rounded-lg border ${color}`}
                />
                <span className="text-xs">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="border-ds-border bg-ds-surface mt-5 rounded-lg border p-6">
          <h2 className="text-ds-text-muted font-mono text-[11px] font-semibold tracking-wide uppercase">
            字体
          </h2>
          <div className="mt-4 space-y-1">
            <p className="text-3xl font-bold">Geist + 中文系统字体</p>
            <p className="text-base">正文 Aa 视频 PurpleInk</p>
            <p className="text-ds-text-muted font-mono text-sm">
              Geist Mono · workspace.local
            </p>
          </div>
        </section>

        <section className="border-ds-border bg-ds-surface mt-5 rounded-lg border p-6">
          <h2 className="text-ds-text-muted font-mono text-[11px] font-semibold tracking-wide uppercase">
            圆角
          </h2>
          <div className="mt-4 flex flex-wrap items-end gap-5">
            {RADII.map(([label, radius]) => (
              <div key={label} className="text-center">
                <div className={`bg-ds-surface-muted size-12 ${radius}`} />
                <span className="text-ds-text-muted mt-2 block font-mono text-[9px]">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="border-ds-border bg-ds-surface mt-5 rounded-lg border p-6">
          <h2 className="text-ds-text-muted font-mono text-[11px] font-semibold tracking-wide uppercase">
            滚动条
          </h2>
          <p className="text-ds-text-muted mt-2 text-xs">
            全局细滚动条：`--scrollbar-*`。浅色 / 深色拇指色不同；切换主题可见差异。
            `.scrollbar-hide` 仍用于需要完全隐藏的区域。
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="border-ds-border h-36 overflow-y-auto rounded-lg border bg-ds-surface-muted p-3">
              <p className="text-xs font-semibold">默认细条</p>
              {Array.from({ length: 12 }, (_, index) => (
                <p key={index} className="text-ds-text-muted mt-2 text-xs">
                  滚动行 {index + 1} · thumb 使用主题 token
                </p>
              ))}
            </div>
            <div className="scrollbar-hide border-ds-border h-36 overflow-y-auto rounded-lg border bg-ds-surface-muted p-3">
              <p className="text-xs font-semibold">scrollbar-hide</p>
              {Array.from({ length: 12 }, (_, index) => (
                <p key={index} className="text-ds-text-muted mt-2 text-xs">
                  仍可滚动，轨道与拇指均隐藏 {index + 1}
                </p>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
