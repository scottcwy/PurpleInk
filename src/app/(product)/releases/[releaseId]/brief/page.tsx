import { ReleaseStepPage } from "../../../_components/release-step-page";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return (
    <ReleaseStepPage
      releaseId={releaseId}
      current="brief"
      title="Release Brief"
      description="未来用于定义受众、发布目标、事实主张、渠道、时长与 CTA，并管理不可变的 Brief 版本。"
      futureGuard="Release 属于当前 Workspace。"
      sources={["Release", "ReleaseBriefVersion", "ProductCapability"]}
    />
  );
}
