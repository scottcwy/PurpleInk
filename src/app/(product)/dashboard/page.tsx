import { RefreshCw, SquarePlus } from "lucide-react";
import { ProjectStatisticsPanel } from "@/components/ui/project-statistics-panel";
import { RecentProjectsPanel } from "@/components/ui/recent-projects-panel";
import { ProductPageHeader } from "../_components/product-page-header";

export default function DashboardPage() {
  return (
    <main className="min-h-screen">
      <ProductPageHeader
        title="工作台"
        subtitle="workspace.local · Stage B snapshot pending"
        actions={
          <>
            <DisabledAction icon={RefreshCw}>刷新</DisabledAction>
            <DisabledAction icon={SquarePlus} primary>
              新建项目
            </DisabledAction>
          </>
        }
      />
      <div className="mx-auto flex max-w-[1280px] flex-col gap-[18px] p-5 sm:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[28px] font-bold tracking-[-0.03em]">统计</h2>
            <p className="text-ds-text-muted mt-1 text-xs">
              查看项目、Pipeline 与 Artifact 的持久快照。
            </p>
          </div>
          <p className="text-ds-text-muted text-[11px]">
            等待 WorkspaceStatisticsSnapshotV1
          </p>
        </header>
        <ProjectStatisticsPanel />
        <RecentProjectsPanel />
      </div>
    </main>
  );
}

function DisabledAction({
  icon: Icon,
  primary = false,
  children,
}: {
  icon: typeof RefreshCw;
  primary?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled
      title="该操作将在 Stage B 接线"
      className={
        primary
          ? "ds-primary-button flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium text-white opacity-60"
          : "border-ds-border bg-ds-surface flex items-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium opacity-60"
      }
    >
      <Icon aria-hidden className="size-4" />
      {children}
    </button>
  );
}
