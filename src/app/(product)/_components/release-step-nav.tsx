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
    <nav aria-label="Release 制作步骤" className="overflow-x-auto pb-2">
      <ol className="flex min-w-max items-center gap-2">
        {RELEASE_STEPS.map(([step, label], index) => {
          const active = step === current;
          return (
            <li key={step} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="h-px w-5 bg-[#cec5b8] dark:bg-white/15" />
              ) : null}
              <Link
                href={`/releases/${encodedReleaseId}/${step}`}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "rounded-full border px-3 py-2 text-xs font-semibold transition-colors",
                  active
                    ? "border-[#171511] bg-[#171511] text-[#fffaf1] dark:border-[#f4ede2] dark:bg-[#f4ede2] dark:text-[#171511]"
                    : "border-[#d9d1c4] bg-[#fffdf8]/70 text-[#696157] hover:border-[#9f9384] hover:text-[#171511] dark:border-white/10 dark:bg-white/5 dark:text-[#bdb4a8] dark:hover:border-white/25 dark:hover:text-white",
                )}
              >
                <span className="mr-1.5 font-mono text-[10px] opacity-60">
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
