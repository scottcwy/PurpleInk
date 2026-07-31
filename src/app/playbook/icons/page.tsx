import Link from "next/link";
import { entriesByCategory } from "../registry";

export default function PlaybookIconsPage() {
  const entries = entriesByCategory("icons");
  return (
    <main className="ds-app-gradient text-ds-text min-h-screen p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/playbook" className="text-ds-text-muted text-sm underline">
          ← 组件手册
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-[-0.03em]">Icons</h1>
        <div className="mt-6 space-y-8">
          {entries.map(({ id, name, Demo }) => (
            <section key={id} id={id}>
              <h2 className="text-ds-text-muted mb-3 font-mono text-[11px] font-semibold tracking-wide uppercase">
                {name}
              </h2>
              <div className="border-ds-border bg-ds-surface rounded-lg border p-6">
                <Demo />
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
