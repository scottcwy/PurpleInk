import { ReleaseStepNav, type ReleaseStep } from "./release-step-nav";
import { UnwiredPanel } from "./unwired-panel";

export function ReleaseStepPage({
  releaseId,
  current,
  title,
  description,
  sources,
  futureGuard,
}: {
  releaseId: string;
  current: ReleaseStep;
  title: string;
  description: string;
  sources: readonly string[];
  futureGuard: string;
}) {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a0442e] dark:text-[#ff8d74]">
              Release workflow
            </p>
            <h1 className="mt-2 font-serif text-4xl tracking-[-0.03em] sm:text-5xl">
              {title}
            </h1>
          </div>
          <code className="rounded-full border border-[#d2c9bd] bg-[#ebe5dc] px-3 py-1.5 text-xs text-[#5f574e] dark:border-white/10 dark:bg-white/5 dark:text-[#bdb4a8]">
            releaseId: {releaseId}
          </code>
        </div>
        <ReleaseStepNav releaseId={releaseId} current={current} />
      </header>
      <UnwiredPanel
        title={title}
        description={description}
        sources={sources}
        futureGuard={futureGuard}
      />
    </main>
  );
}
