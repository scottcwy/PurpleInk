import Link from "next/link";
import { cn } from "@/lib/utils";

export const RELEASE_STEPS = [
  ["brief", "Brief"],
  ["flow", "Flow"],
  ["evidence", "Evidence"],
  ["storyboard", "Storyboard"],
  ["review", "Review"],
  ["artifacts", "Artifacts"],
] as const;

export type ReleaseStep = (typeof RELEASE_STEPS)[number][0];

export function ReleaseStepNav({
  releaseId,
  current,
}: {
  releaseId: string;
  current: ReleaseStep;
}) {
  const encodedReleaseId = encodeURIComponent(releaseId);

  return (
    <nav
      aria-label="Release 制作步骤"
      className="scrollbar-hide overflow-x-auto pb-1"
    >
      <ol className="flex min-w-max items-center gap-2">
        {RELEASE_STEPS.map(([step, label], index) => {
          const active = step === current;
          return (
            <li key={step} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="bg-ds-border h-px w-4" />
              ) : null}
              <Link
                href={`/releases/${encodedReleaseId}/${step}`}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-md border px-3 text-xs font-semibold transition-colors",
                  active
                    ? "border-ds-primary bg-ds-primary text-white"
                    : "border-ds-border bg-ds-surface text-ds-text-muted hover:bg-ds-surface-muted hover:text-ds-text"
                )}
              >
                <span className="mr-2 font-mono text-[9px] opacity-65">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
