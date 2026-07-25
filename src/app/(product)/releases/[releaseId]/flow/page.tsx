import { ReleaseStepPage } from "../../../_components/release-step-page";
import { WorkflowCanvas } from "@/features/workflow/workflow-canvas";

export default async function FlowPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return (
    <ReleaseStepPage
      releaseId={releaseId}
      current="flow"
      title="Product Flow"
      description="未来用于选择或派生已批准的产品操作路径，并审阅 FlowNode 与 Capability 映射。"
      futureGuard="当前 ReleaseBriefVersion 已批准。"
      sources={["ProductFlowVersion", "FlowNode", "ProductCapability"]}
    >
      <WorkflowCanvas />
    </ReleaseStepPage>
  );
}
