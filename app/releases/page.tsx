import { AppShell } from "@/components/control-plane/app-shell";
import { CollectionCanvas } from "@/components/control-plane/collection-canvas";
import type { ReactNode } from "react";

export default function ReleasesPage(): ReactNode {
  return (
    <AppShell
      currentPath="/releases"
      title="Release library"
      description="Version-pinned launch work across every product."
      variant="canvas"
    >
      <CollectionCanvas kind="releases" />
    </AppShell>
  );
}
