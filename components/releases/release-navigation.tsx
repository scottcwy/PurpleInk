import { getReleaseRouteAccess, releaseSteps } from "@/lib/releases/domain";
import type { ReleaseRecord, ReleaseStepSlug } from "@/lib/releases/types";
import { Check, LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function ReleaseNavigation({
  release,
  current,
}: {
  release: ReleaseRecord;
  current: ReleaseStepSlug;
}): ReactNode {
  const currentIndex = releaseSteps.findIndex((step) => step.slug === current);

  return (
    <nav
      aria-label="Release steps"
      className="border-border bg-muted/45 mb-6 overflow-x-auto border-y"
    >
      <ol className="flex min-w-[46rem]">
        {releaseSteps.map((step, index) => {
          const access = getReleaseRouteAccess(release, step.slug);
          const active = step.slug === current;
          const completed = index < currentIndex && access.allowed;
          const content = (
            <>
              <span
                className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : completed
                      ? "bg-proof text-proof-ink"
                      : "bg-background text-muted-foreground"
                }`}
              >
                {completed ? (
                  <Check size={13} aria-label="Completed" />
                ) : access.allowed ? (
                  index + 1
                ) : (
                  <LockKeyhole size={11} aria-label="Locked" />
                )}
              </span>
              <span className="text-xs font-bold">{step.label}</span>
            </>
          );

          return (
            <li
              key={step.slug}
              className="border-border min-w-0 flex-1 border-r last:border-r-0"
            >
              {access.allowed ? (
                <Link
                  href={`/releases/${release.id}/${step.slug}`}
                  aria-current={active ? "step" : undefined}
                  className={`focus-ring flex h-14 items-center justify-center gap-2 px-3 ${
                    active
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                  }`}
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  title={access.reason}
                  className="text-muted-foreground flex h-14 cursor-not-allowed items-center justify-center gap-2 px-3 opacity-65"
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
