import { AppShell } from "@/components/control-plane/app-shell";
import {
  EmptyState,
  primaryActionClassName,
} from "@/components/control-plane/empty-state";
import { Plus, Rocket } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export default function DashboardPage(): ReactNode {
  return (
    <AppShell
      currentPath="/dashboard"
      title="Release control room"
      description="Recent work, approvals, and failed jobs across the workspace."
      action={
        <Link className={primaryActionClassName} href="/releases">
          <Plus size={16} />
          <span className="hidden sm:inline">New release</span>
        </Link>
      }
    >
      <EmptyState
        icon={Rocket}
        title="No active releases"
        detail="Start a release after adding your first product."
        action={
          <Link className={primaryActionClassName} href="/products">
            Add a product
          </Link>
        }
      />
    </AppShell>
  );
}
