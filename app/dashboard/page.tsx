import { AppShell } from "@/components/control-plane/app-shell";
import { Button } from "@/components/ui/button";
import {
  ArrowUp,
  Ban,
  Boxes,
  CheckCheck,
  CircleAlert,
  Package,
  Rocket,
  ServerOff,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/*
THESIS: A release starts on a focused canvas, not a dashboard of invented metrics.
OWN-WORLD: Night navigation, paper canvas, flat controls, and one spectral ink wash.
STORY: Name the release intent, connect a Product, then move through verified stages.
FIRST VIEWPORT: An icon switcher anchors the left; the disabled ReleaseBrief composer owns the right.
FORM: Operate-mode command canvas, adapted from the supplied Creatify composition without agent semantics.
*/

export default function DashboardPage(): ReactNode {
  return (
    <AppShell
      currentPath="/dashboard"
      title="Release control room"
      description="Recent work, approvals, and failed jobs across the workspace."
      variant="canvas"
    >
      <section
        data-dashboard-canvas="true"
        className="dashboard-canvas relative isolate flex min-h-[calc(100svh-4rem)] flex-col overflow-hidden lg:min-h-screen"
        aria-labelledby="dashboard-title"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-[32%] -z-10 h-[52%] bg-[var(--gradient-brand-spectrum)] [mask-image:linear-gradient(to_bottom,transparent,black_50%,transparent)] opacity-20 dark:opacity-25"
        />

        <header className="border-border flex min-h-16 items-center justify-between gap-4 border-b px-5 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="bg-accent text-accent-foreground flex size-8 items-center justify-center rounded-[var(--radius-compact)]">
              <Rocket size={16} aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold">Release room</p>
              <p className="text-muted-foreground text-xs">
                Workspace data unavailable
              </p>
            </div>
          </div>
          <span className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <span className="bg-muted-foreground size-1.5 rounded-full" />
            Service offline
          </span>
        </header>

        <div className="flex flex-1 items-center justify-center px-5 py-12 sm:px-8 sm:py-16 lg:px-12">
          <div className="w-full max-w-3xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-accent-strong text-sm font-semibold">
                Verified release workflow
              </p>
              <h1
                id="dashboard-title"
                className="mt-3 text-3xl leading-tight font-bold tracking-[-0.025em] text-balance sm:text-4xl lg:text-5xl"
              >
                What are you launching?
              </h1>
              <p className="text-muted-foreground mx-auto mt-4 max-w-[62ch] text-sm leading-6 sm:text-base">
                Start with the release outcome. PurpleInk keeps factual scenes
                tied to approved product evidence as the work moves toward
                review and delivery.
              </p>
            </div>

            <form
              className="border-border bg-card mt-8 overflow-hidden rounded-[var(--radius-surface)] border"
              aria-label="Create release"
            >
              <div className="border-border flex items-center justify-between border-b px-5 py-3">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Boxes size={16} aria-hidden="true" />
                  Release brief
                </span>
                <span className="text-muted-foreground text-xs">
                  Product required
                </span>
              </div>
              <label htmlFor="release-intent" className="sr-only">
                Release intent
              </label>
              <textarea
                id="release-intent"
                name="releaseIntent"
                disabled
                rows={4}
                placeholder="Describe the audience, outcome, and approved claim for this release"
                className="text-foreground placeholder:text-muted-foreground min-h-32 w-full resize-none bg-transparent px-5 py-4 text-base leading-6 outline-none disabled:cursor-not-allowed disabled:opacity-100"
              />
              <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                <button
                  type="button"
                  disabled
                  className="border-border text-muted-foreground flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <Package size={16} aria-hidden="true" />
                  Select product
                </button>
                <Button
                  type="submit"
                  disabled
                  aria-describedby="service-required"
                >
                  Create release
                  <ArrowUp aria-hidden="true" />
                </Button>
              </div>
            </form>

            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p
                id="service-required"
                className="text-muted-foreground flex items-center gap-2 text-xs"
              >
                <ServerOff size={14} aria-hidden="true" />
                Workspace service required before a Release can be created.
              </p>
              <nav aria-label="Release resources" className="flex gap-1">
                <Link
                  href="/products"
                  className="focus-ring hover:bg-muted rounded-[var(--radius-compact)] px-3 py-2 text-xs font-semibold transition-colors"
                >
                  Browse products
                </Link>
                <Link
                  href="/releases"
                  className="focus-ring hover:bg-muted rounded-[var(--radius-compact)] px-3 py-2 text-xs font-semibold transition-colors"
                >
                  Open releases
                </Link>
              </nav>
            </div>
          </div>
        </div>

        <section
          className="border-border bg-background/90 border-t"
          aria-labelledby="workspace-signals-title"
        >
          <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
            <div>
              <h2
                id="workspace-signals-title"
                className="text-sm font-semibold"
              >
                Workspace signals
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                Aggregated release data is not connected.
              </p>
            </div>
            <span className="text-muted-foreground hidden items-center gap-2 text-xs sm:flex">
              <Ban size={14} aria-hidden="true" />
              No inferred status
            </span>
          </div>
          <ul className="border-border grid border-t sm:grid-cols-2 xl:grid-cols-5">
            <li className="border-border flex min-h-16 items-center gap-3 border-b px-5 py-3 sm:border-r lg:px-6 xl:border-b-0">
              <CircleAlert
                className="text-muted-foreground"
                size={16}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">Blocking status</span>
            </li>
            <li className="border-border flex min-h-16 items-center gap-3 border-b px-5 py-3 lg:px-6 xl:border-r xl:border-b-0">
              <CheckCheck
                className="text-muted-foreground"
                size={16}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">Pending approvals</span>
            </li>
            <li className="border-border flex min-h-16 items-center gap-3 border-b px-5 py-3 sm:border-r lg:px-6 xl:border-b-0">
              <Rocket
                className="text-muted-foreground"
                size={16}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">Active releases</span>
            </li>
            <li className="border-border flex min-h-16 items-center gap-3 border-b px-5 py-3 lg:px-6 xl:border-r xl:border-b-0">
              <Package
                className="text-muted-foreground"
                size={16}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">Recent products</span>
            </li>
            <li className="flex min-h-16 items-center gap-3 px-5 py-3 lg:px-6">
              <ServerOff
                className="text-muted-foreground"
                size={16}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">Failed jobs</span>
            </li>
          </ul>
        </section>
      </section>
    </AppShell>
  );
}
