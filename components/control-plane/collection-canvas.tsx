import { Button } from "@/components/ui/button";
import {
  ArrowUp,
  Ban,
  CheckCheck,
  CircleAlert,
  FileStack,
  Filter,
  Flag,
  History,
  Link2,
  Package,
  Palette,
  Rocket,
  Search,
  ServerOff,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/*
THESIS: A collection starts with one honest creation threshold, not an invented table.
OWN-WORLD: Night switcher, paper canvas, flat controls, and one spectral ink wash.
STORY: Name the durable object, see why creation is unavailable, then move to a real route.
FIRST VIEWPORT: Library context sits above a centered disabled command surface and ordered data regions.
FORM: Operate-mode collection canvas extending the confirmed Dashboard composition.
*/

type CollectionKind = "products" | "releases";

type CollectionCanvasProps = {
  kind: CollectionKind;
};

const collectionConfig = {
  products: {
    headerTitle: "Product library",
    headerIcon: Package,
    kicker: "Persistent product context",
    title: "Which product belongs in your library?",
    description:
      "Products keep canonical identity, approved evidence, and reusable flows stable across every Release.",
    formLabel: "Add product",
    formTitle: "Product identity",
    formStatus: "Name and HTTPS URL required",
    action: "Add product",
    unavailableMessage:
      "Product service required before a Product can be added.",
    resourceLabel: "Product resources",
    resources: [
      { href: "/dashboard", label: "Return to dashboard" },
      { href: "/releases", label: "Open releases" },
    ],
    structureTitle: "Product collection structure",
    structureDescription:
      "Product records and derived summaries are not connected.",
    regions: [
      { label: "Search and filters", icon: Search },
      { label: "Product results", icon: Package },
      { label: "Brand kit readiness", icon: Palette },
      { label: "Approved flows", icon: Waypoints },
      { label: "Recent releases", icon: History },
      { label: "Pagination", icon: FileStack },
    ],
  },
  releases: {
    headerTitle: "Release library",
    headerIcon: Rocket,
    kicker: "Version-pinned release workflow",
    title: "What are you releasing?",
    description:
      "Start with a Product and release outcome. PurpleInk keeps each stage tied to approved versions and evidence.",
    formLabel: "Create release",
    formTitle: "Release intent",
    formStatus: "Product required",
    action: "Create release",
    unavailableMessage:
      "Release service required before a Release can be created.",
    resourceLabel: "Release resources",
    resources: [
      { href: "/products", label: "Browse products" },
      { href: "/dashboard", label: "Return to dashboard" },
    ],
    structureTitle: "Release collection structure",
    structureDescription: "Release lifecycle and stage data are not connected.",
    regions: [
      { label: "Search and filters", icon: Filter },
      { label: "Release results", icon: Rocket },
      { label: "Current stage", icon: Flag },
      { label: "Pending approvals", icon: CheckCheck },
      { label: "Failed jobs", icon: CircleAlert },
      { label: "Pagination", icon: FileStack },
    ],
  },
} as const;

function ProductCreatorFields(): ReactNode {
  return (
    <div className="grid sm:grid-cols-2">
      <label className="border-border flex min-h-24 flex-col justify-center gap-2 border-b px-5 py-4 sm:border-r sm:border-b-0">
        <span className="text-muted-foreground text-xs font-medium">
          Product name
        </span>
        <input
          name="productName"
          type="text"
          disabled
          placeholder="Product name"
          className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-base outline-none disabled:cursor-not-allowed disabled:opacity-100"
        />
      </label>
      <label className="flex min-h-24 flex-col justify-center gap-2 px-5 py-4">
        <span className="text-muted-foreground text-xs font-medium">
          Canonical URL
        </span>
        <input
          name="canonicalUrl"
          type="url"
          disabled
          placeholder="https://product.example"
          className="text-foreground placeholder:text-muted-foreground w-full bg-transparent text-base outline-none disabled:cursor-not-allowed disabled:opacity-100"
        />
      </label>
    </div>
  );
}

function ReleaseCreatorPrerequisite(): ReactNode {
  return (
    <div className="flex min-h-32 flex-col items-start justify-center gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-compact)]">
          <Package size={18} aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold">
            Product selection unavailable
          </span>
          <span className="text-muted-foreground mt-1 block text-xs leading-5">
            Workspace service is required before a Product can be selected.
          </span>
        </span>
      </div>
      <button
        type="button"
        disabled
        className="border-border text-muted-foreground flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70"
      >
        <Package size={16} aria-hidden="true" />
        Select product
      </button>
    </div>
  );
}

export function CollectionCanvas({ kind }: CollectionCanvasProps): ReactNode {
  const config = collectionConfig[kind];
  const HeaderIcon = config.headerIcon;
  const serviceMessageId = `${kind}-service-required`;

  return (
    <section
      data-collection-canvas={kind}
      className="relative isolate flex min-h-[calc(100svh-4rem)] flex-col overflow-hidden lg:min-h-screen"
      aria-labelledby={`${kind}-canvas-title`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[31%] -z-10 h-[48%] bg-[var(--gradient-brand-spectrum)] [mask-image:linear-gradient(to_bottom,transparent,black_50%,transparent)] opacity-20 dark:opacity-25"
      />

      <header className="border-border flex min-h-16 items-center justify-between gap-4 border-b px-5 sm:px-8 lg:px-10">
        <div className="flex items-center gap-3">
          <span className="bg-accent text-accent-foreground flex size-8 items-center justify-center rounded-[var(--radius-compact)]">
            <HeaderIcon size={16} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold">{config.headerTitle}</p>
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
              {config.kicker}
            </p>
            <h1
              id={`${kind}-canvas-title`}
              className="mt-3 text-3xl leading-tight font-bold tracking-[-0.025em] text-balance sm:text-4xl lg:text-5xl"
            >
              {config.title}
            </h1>
            <p className="text-muted-foreground mx-auto mt-4 max-w-[68ch] text-sm leading-6 sm:text-base">
              {config.description}
            </p>
          </div>

          <form
            className="border-border bg-card mt-8 overflow-hidden rounded-[var(--radius-surface)] border"
            aria-label={config.formLabel}
          >
            <div className="border-border flex items-center justify-between gap-4 border-b px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {kind === "products" ? (
                  <Link2 size={16} aria-hidden="true" />
                ) : (
                  <Rocket size={16} aria-hidden="true" />
                )}
                {config.formTitle}
              </span>
              <span className="text-muted-foreground text-right text-xs">
                {config.formStatus}
              </span>
            </div>

            {kind === "products" ? (
              <ProductCreatorFields />
            ) : (
              <ReleaseCreatorPrerequisite />
            )}

            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <span className="text-muted-foreground flex min-h-11 items-center gap-2 px-1 text-sm font-medium">
                <ServerOff size={16} aria-hidden="true" />
                Commands unavailable
              </span>
              <Button
                type="submit"
                disabled
                aria-describedby={serviceMessageId}
              >
                {config.action}
                <ArrowUp aria-hidden="true" />
              </Button>
            </div>
          </form>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p
              id={serviceMessageId}
              className="text-muted-foreground flex items-center gap-2 text-xs"
            >
              <ServerOff size={14} aria-hidden="true" />
              {config.unavailableMessage}
            </p>
            <nav aria-label={config.resourceLabel} className="flex gap-1">
              {config.resources.map((resource) => (
                <Link
                  key={resource.href}
                  href={resource.href}
                  className="focus-ring hover:bg-muted rounded-[var(--radius-compact)] px-3 py-2 text-xs font-semibold transition-colors"
                >
                  {resource.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>

      <section
        className="border-border bg-background/90 border-t"
        aria-labelledby={`${kind}-structure-title`}
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
          <div>
            <h2
              id={`${kind}-structure-title`}
              className="text-sm font-semibold"
            >
              {config.structureTitle}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {config.structureDescription}
            </p>
          </div>
          <span className="text-muted-foreground hidden items-center gap-2 text-xs sm:flex">
            <Ban size={14} aria-hidden="true" />
            No inferred status
          </span>
        </div>
        <ol className="border-border grid border-t sm:grid-cols-2 xl:grid-cols-6">
          {config.regions.map(({ label, icon: RegionIcon }, index) => (
            <li
              key={label}
              className={`border-border flex min-h-16 items-center gap-3 border-b px-5 py-3 sm:border-r lg:px-6 xl:border-b-0 ${
                index === config.regions.length - 1
                  ? "sm:border-r-0"
                  : "xl:border-r"
              }`}
            >
              <RegionIcon
                className="text-muted-foreground shrink-0"
                size={16}
                aria-hidden="true"
              />
              <span className="text-sm font-medium">{label}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
