import { UnwiredPanel } from "./unwired-panel";

export function RouteShellPage({
  eyebrow,
  title,
  description,
  sources,
  context,
}: {
  eyebrow: string;
  title: string;
  description: string;
  sources: readonly string[];
  context?: string;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <header className="mb-10 grid gap-5 border-b border-[#d8d0c4] pb-8 dark:border-white/10 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#a0442e] dark:text-[#ff8d74]">
            {eyebrow}
          </p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.98] tracking-[-0.035em] sm:text-6xl">
            {title}
          </h1>
        </div>
        {context ? (
          <code className="w-fit rounded-full border border-[#d2c9bd] bg-[#ebe5dc] px-3 py-1.5 text-xs text-[#5f574e] dark:border-white/10 dark:bg-white/5 dark:text-[#bdb4a8]">
            {context}
          </code>
        ) : null}
      </header>
      <UnwiredPanel title={title} description={description} sources={sources} />
    </main>
  );
}
