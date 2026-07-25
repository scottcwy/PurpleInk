import Link from "next/link";
import { entriesByCategory } from "../registry";

export default function PlaybookPatternsPage() {
  const entries = entriesByCategory("patterns");

  return (
    <main className="ds-app-gradient text-ds-text min-h-screen p-5 sm:p-8">
      <div className="mx-auto max-w-[1440px]">
        <Link href="/playbook" className="text-ds-text-muted text-sm underline">
          ← 组件手册
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">组合模式</h1>
        <p className="text-ds-text-muted mt-2 text-sm">
          页面级组合采用明确 fixture 标签，与业务运行真值隔离。
        </p>
        <div className="mt-6 space-y-8">
          {entries.map(({ id, name, Demo }) => (
            <section key={id}>
              <h2 className="text-ds-text-muted mb-3 font-mono text-[11px] font-semibold tracking-wide uppercase">
                {name}
              </h2>
              <Demo />
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
