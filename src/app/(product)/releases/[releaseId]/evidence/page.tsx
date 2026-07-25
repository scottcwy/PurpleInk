import { ReleaseStepPage } from "../../../_components/release-step-page";

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return (
    <ReleaseStepPage
      releaseId={releaseId}
      current="evidence"
      title="Evidence"
      description="未来用于审阅 CaptureRun 产生的节点证据、断言结果、来源哈希与脱敏状态。"
      futureGuard="已固定且批准 ProductFlowVersion。"
      sources={["CaptureRun", "NodeEvidence", "SourceAsset", "EvidencePackage"]}
    />
  );
}
