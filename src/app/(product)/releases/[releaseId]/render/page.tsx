import { permanentRedirect } from "next/navigation";

export default async function LegacyRenderPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  permanentRedirect(`/releases/${encodeURIComponent(releaseId)}/artifacts`);
}
