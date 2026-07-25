import type { ReactNode } from "react";
import { Database, ShieldAlert } from "lucide-react";
import { ProductPageHeader } from "./product-page-header";
import { ReleaseStepNav, type ReleaseStep } from "./release-step-nav";
import { UnwiredPanel } from "./unwired-panel";

export function ReleaseStepPage({
  releaseId,
  current,
  title,
  description,
  sources,
  futureGuard,
  children,
}: {
  releaseId: string;
  current: ReleaseStep;
  title: string;
  description: string;
  sources: readonly string[];
  futureGuard: string;
  children?: ReactNode;
}) {
  return (
    <main className="min-h-screen">
      <ProductPageHeader
        title={title}
        subtitle={`releaseId: ${releaseId} · Stage B route shell`}
      />
      <div className="mx-auto max-w-[1480px] p-5 sm:p-8">
        <header className="mb-6">
          <p className="text-ds-text-muted font-mono text-[10px] tracking-[0.16em] uppercase">
            Release workflow
          </p>
          <h2 className="mt-2 text-[28px] font-bold tracking-[-0.03em]">
            {title}
          </h2>
          <div className="mt-5">
            <ReleaseStepNav releaseId={releaseId} current={current} />
          </div>
        </header>
        {children ? (
          <div className="space-y-4">
            <StageBContext
              description={description}
              sources={sources}
              futureGuard={futureGuard}
            />
            {children}
          </div>
        ) : (
          <UnwiredPanel
            title={title}
            description={description}
            sources={sources}
            futureGuard={futureGuard}
          />
        )}
      </div>
    </main>
  );
}

function StageBContext({
  description,
  sources,
  futureGuard,
}: {
  description: string;
  sources: readonly string[];
  futureGuard: string;
}) {
  return (
    <section className="border-ds-border bg-ds-surface text-ds-text-muted flex flex-wrap items-start justify-between gap-4 rounded-lg border p-4 text-xs">
      <div className="max-w-3xl">
        <p className="text-ds-text font-semibold">该页尚未接线（Stage B）</p>
        <p className="mt-1 leading-5">{description}</p>
        <p className="mt-2 flex items-center gap-2">
          <ShieldAlert aria-hidden className="text-ds-blue size-3.5" />
          未来进入前置：{futureGuard}
        </p>
      </div>
      <div>
        <p className="text-ds-text flex items-center gap-2 font-semibold">
          <Database aria-hidden className="size-3.5" />
          未来数据来源
        </p>
        <p className="mt-2 font-mono text-[10px]">{sources.join(" · ")}</p>
      </div>
    </section>
  );
}
