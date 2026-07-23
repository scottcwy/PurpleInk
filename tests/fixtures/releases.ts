import type { ReleaseRecord } from "@/lib/releases/types";

export const mockRelease: ReleaseRecord = { id: "summer-2026", productId: "frameio", productName: "Frameboard", name: "Summer campaign release", lifecycle: "active", stage: "evidence_review", revision: 12 };

export const deliveredRelease: ReleaseRecord = { id: "launch-2026", productId: "frameio", productName: "Frameboard", name: "Campaigns launch", lifecycle: "delivered", stage: "complete", revision: 19 };

export function getRelease(releaseId: string): ReleaseRecord | null {
  if (releaseId === mockRelease.id) return mockRelease;
  if (releaseId === deliveredRelease.id) return deliveredRelease;
  return null;
}
