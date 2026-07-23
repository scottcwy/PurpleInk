import type { ReleaseStepSlug } from "@/lib/releases/domain";
import { notFound } from "next/navigation";

export async function renderReleasePage(releaseId: string, step: ReleaseStepSlug): Promise<never> {
  void releaseId;
  void step;
  notFound();
}
