import { ReleaseStepPage } from "../../../_components/release-step-page";

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return (
    <ReleaseStepPage
      releaseId={releaseId}
      current="storyboard"
      title="Storyboard"
      description="未来用于把已批准的 Brief、Capability 与 NodeEvidence 编排成可追溯的视频叙事合同。"
      futureGuard="EvidencePackage 已批准。"
      sources={["StoryboardVersion", "Scene", "NodeEvidence"]}
    />
  );
}
