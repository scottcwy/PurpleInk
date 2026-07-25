import { ReleaseStepPage } from "../../../_components/release-step-page";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return (
    <ReleaseStepPage
      releaseId={releaseId}
      current="review"
      title="Review"
      description="未来用于审阅低成本预览，并分别记录事实、文案和视觉反馈与批准决定。"
      futureGuard="StoryboardVersion 已批准。"
      sources={["Preview", "ReviewFeedback", "ApprovalRecord"]}
    />
  );
}
