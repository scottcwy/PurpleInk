import { renderReleasePage } from "@/components/releases/release-page";
export default async function Page({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  return renderReleasePage(releaseId, "artifacts");
}
