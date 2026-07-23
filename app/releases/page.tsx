import { AppShell } from "@/components/control-plane/app-shell";
import {
  EmptyState,
  primaryActionClassName,
} from "@/components/control-plane/empty-state";
import { Plus, Rocket } from "lucide-react";
import type { ReactNode } from "react";

export default function ReleasesPage(): ReactNode {
  return (
    <AppShell
      currentPath="/releases"
      title="Releases"
      description="Version-pinned launch work across every product."
      action={
        <button className={primaryActionClassName} type="button">
          <Plus size={16} />
          <span className="hidden sm:inline">New release</span>
        </button>
      }
    >
      <EmptyState
        icon={Rocket}
        title="No releases yet"
        detail="Create a release after selecting a product."
        action={
          <button className={primaryActionClassName} type="button">
            <Plus size={16} />
            New release
          </button>
        }
      />
    </AppShell>
  );
}
