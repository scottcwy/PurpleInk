import { AppShell } from "@/components/control-plane/app-shell";
import { Breadcrumbs } from "@/components/control-plane/breadcrumbs";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReleaseStepSlug } from "@/lib/releases/domain";
import { releaseSteps } from "@/lib/releases/domain";
import type { ReactNode } from "react";

const stageCopy: Record<
  ReleaseStepSlug,
  { title: string; unavailable: string; description: string; regions: string[] }
> = {
  brief: {
    title: "Release brief",
    unavailable: "Brief unavailable",
    description:
      "Define the approved audience, claims, channels, and call to action.",
    regions: [
      "Structured brief",
      "Capability claims",
      "Version history",
      "Approval record",
    ],
  },
  flow: {
    title: "Release flow",
    unavailable: "Flow selection unavailable",
    description:
      "Select or establish the approved semantic product path for this release.",
    regions: [
      "Reusable flows",
      "Version detail",
      "Discovery status",
      "Approval record",
    ],
  },
  evidence: {
    title: "Release evidence",
    unavailable: "Evidence unavailable",
    description:
      "Review capture runs, checkpoints, redaction, and traceable product evidence.",
    regions: [
      "Run context",
      "Node execution",
      "Media evidence",
      "Evidence inspector",
    ],
  },
  storyboard: {
    title: "Release storyboard",
    unavailable: "Storyboard unavailable",
    description:
      "Arrange approved claims and evidence into a concise scene sequence.",
    regions: ["Scene sequence", "Scene editor", "Fact status", "Provenance"],
  },
  review: {
    title: "Preview review",
    unavailable: "Preview unavailable",
    description:
      "Review the generated preview and separate factual, copy, and visual feedback.",
    regions: [
      "Preview player",
      "Scene navigation",
      "Review feedback",
      "Quality gates",
    ],
  },
  artifacts: {
    title: "Release artifacts",
    unavailable: "Artifacts unavailable",
    description:
      "Track final rendering and retrieve approved publication files.",
    regions: [
      "Render status",
      "Current attempt",
      "Artifact delivery",
      "Bundle provenance",
    ],
  },
};

export async function renderReleasePage(
  releaseId: string,
  step: ReleaseStepSlug
): Promise<ReactNode> {
  const copy = stageCopy[step];

  return (
    <AppShell
      currentPath={`/releases/${releaseId}/${step}`}
      title={copy.title}
      description={copy.description}
    >
      <Breadcrumbs
        items={[
          { label: "Releases", href: "/releases" },
          { label: "Release" },
          { label: copy.title },
        ]}
      />
      <nav
        aria-label="Release steps"
        className="border-border mb-6 overflow-x-auto border-y"
      >
        <ol className="flex min-w-[46rem]">
          {releaseSteps.map((releaseStep, index) => {
            const current = releaseStep.slug === step;
            return (
              <li
                key={releaseStep.slug}
                className="border-border min-w-0 flex-1 border-r last:border-r-0"
              >
                <span
                  aria-current={current ? "step" : undefined}
                  aria-disabled={current ? undefined : "true"}
                  className={`flex h-14 items-center justify-center gap-2 px-3 text-xs font-semibold ${
                    current
                      ? "bg-background text-foreground"
                      : "bg-muted/45 text-muted-foreground"
                  }`}
                >
                  <span className="bg-background flex size-6 items-center justify-center rounded-full font-mono text-xs">
                    {index + 1}
                  </span>
                  {releaseStep.label}
                </span>
              </li>
            );
          })}
        </ol>
      </nav>
      <ServiceBoundary
        title={copy.unavailable}
        description="Release state unavailable. The page will not infer lifecycle, stage, permissions, or pinned versions without a release query."
        regions={copy.regions}
      />
    </AppShell>
  );
}
