import { ProductPageHeader } from "./product-page-header";
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
    <main className="min-h-screen">
      <ProductPageHeader
        title={title}
        subtitle={context ?? `${eyebrow} · Stage B route shell`}
      />
      <div className="mx-auto max-w-6xl p-5 sm:p-8">
        <header className="mb-6">
          <p className="text-ds-text-muted font-mono text-[10px] tracking-[0.16em] uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-[28px] font-bold tracking-[-0.03em]">
            {title}
          </h2>
        </header>
        <UnwiredPanel
          title={title}
          description={description}
          sources={sources}
        />
      </div>
    </main>
  );
}
