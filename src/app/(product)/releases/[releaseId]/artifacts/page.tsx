import { ReleaseStepPage } from "../../../_components/release-step-page";

export default async function ArtifactsPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return (
    <ReleaseStepPage
      releaseId={releaseId}
      current="artifacts"
      title="Artifacts"
      description="未来用于区分终稿排队、生成、失败、质检未通过和可交付状态，并管理真实交付文件。"
      futureGuard="Preview 通过质量检查且已批准。"
      sources={["RenderJob", "RenderAttempt", "Artifact"]}
    />
  );
}
