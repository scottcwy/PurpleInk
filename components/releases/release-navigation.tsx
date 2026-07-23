import { getReleaseRouteAccess, releaseSteps } from "@/lib/releases/domain";
import type { ReleaseRecord, ReleaseStepSlug } from "@/lib/releases/types";
import { Check, LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function ReleaseNavigation({ release, current }: { release: ReleaseRecord; current: ReleaseStepSlug }): ReactNode {
  const currentIndex = releaseSteps.findIndex((step) => step.slug === current);
  return <nav aria-label="Release steps" className="mb-6 overflow-x-auto border-y border-border bg-muted/45"><ol className="flex min-w-[46rem]">{releaseSteps.map((step, index) => {
    const access = getReleaseRouteAccess(release, step.slug); const active = step.slug === current; const completed = index < currentIndex && access.allowed;
    const content = <><span className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${active ? "bg-accent text-white" : completed ? "bg-proof text-proof-ink" : "bg-background text-muted-foreground"}`}>{completed ? <Check size={13} /> : access.allowed ? index + 1 : <LockKeyhole size={11} />}</span><span className="text-xs font-bold">{step.label}</span></>;
    return <li key={step.slug} className="min-w-0 flex-1 border-r border-border last:border-r-0">{access.allowed ? <Link href={`/releases/${release.id}/${step.slug}`} aria-current={active ? "step" : undefined} className={`focus-ring flex h-14 items-center justify-center gap-2 px-3 ${active ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/70 hover:text-foreground"}`}>{content}</Link> : <span aria-disabled="true" title={access.reason} className="flex h-14 cursor-not-allowed items-center justify-center gap-2 px-3 text-muted-foreground opacity-65">{content}</span>}</li>;
  })}</ol></nav>;
}
