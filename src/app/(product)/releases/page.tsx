import { RouteShellPage } from "../_components/route-shell-page";

export default function ReleasesPage() {
  return (
    <RouteShellPage
      eyebrow="Cross-product delivery ledger"
      title="Releases"
      description="未来用于列出 Workspace 下的 Release 及生命周期；当前不展示假阶段、假负责人或假审批状态。"
      sources={["Release", "Product", "ApprovalRequest", "PipelineRun"]}
    />
  );
}
