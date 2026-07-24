import { AppShell } from "@/components/control-plane/app-shell";
import { ServiceBoundary } from "@/components/control-plane/service-boundary";
import type { ReactNode } from "react";

export default function DashboardPage(): ReactNode {
  return (
    <AppShell
      currentPath="/dashboard"
      title="Release control room"
      description="Recent work, approvals, and failed jobs across the workspace."
    >
      <ServiceBoundary
        title="Dashboard data unavailable"
        description="No active releases can be shown until workspace products, approvals, and jobs are connected."
        regions={[
          "Blocking status",
          "Pending approvals",
          "Active releases",
          "Recent products",
          "Failed jobs",
        ]}
      />
    </AppShell>
  );
}
