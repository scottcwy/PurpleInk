import { AppShell } from "@/components/control-plane/app-shell";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReactNode } from "react";

export default function ReleasesPage(): ReactNode {
  return (
    <AppShell
      currentPath="/releases"
      title="Releases"
      description="Version-pinned launch work across every product."
    >
      <ServiceBoundary
        title="Release service unavailable"
        description="No releases yet can be determined until release queries and commands are connected."
        regions={["Search and filters", "Release results", "Pagination"]}
      />
    </AppShell>
  );
}
