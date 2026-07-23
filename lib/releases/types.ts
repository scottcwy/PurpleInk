import type { ReleaseLifecycle, ReleaseStage } from "./domain";

export type { ReleaseStage, ReleaseStepSlug } from "./domain";

export type ReleaseRecord = {
  id: string;
  productId: string;
  productName: string;
  name: string;
  lifecycle: ReleaseLifecycle;
  stage: ReleaseStage;
  failedFromStage?: ReleaseStage;
  revision: number;
};
