import { RouteShellPage } from "../_components/route-shell-page";

export default function DashboardPage() {
  return (
    <RouteShellPage
      eyebrow="Workspace control room"
      title="Dashboard"
      description="未来用于汇总需要关注的 Product、Release、审批与失败任务；当前不显示虚构统计或运行状态。"
      sources={["Product", "Release", "ApprovalRequest", "TaskAttempt", "RenderJob"]}
    />
  );
}
