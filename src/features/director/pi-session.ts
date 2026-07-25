import type { DirectorOutput, DirectorOutputPolicy } from "./pi-output";
import type { PipelineStage } from "./types";

export const STAGE_A_UNAVAILABLE_CODE = "NOT_AVAILABLE_STAGE_A";

export interface DirectorToolResult {
  content: string;
  details?: unknown;
  terminate?: boolean;
}

export interface DirectorTool {
  name: string;
  label: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
  execute: (
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<DirectorToolResult>;
}

export interface DirectorRunInput {
  prompt: string;
  tools?: readonly DirectorTool[];
  output: DirectorOutputPolicy;
}

export type DirectorRunResult = DirectorOutput;

export interface DirectorSession {
  id: string;
  storageKey: string;
  run(input: DirectorRunInput): Promise<DirectorRunResult>;
  close(): Promise<void>;
}

export interface DirectorSessionInput {
  projectId: string;
  nodeId: string;
  nodeType?: string | null;
  stage: PipelineStage;
  resumeSessionKey?: string;
}

/**
 * Stage A intentionally does not ship the historical Pi runtime.
 * Keeping the function contract lets existing callers compile while making the
 * missing capability explicit instead of returning fabricated output.
 */
export async function createDirectorSession(
  _input: DirectorSessionInput,
): Promise<DirectorSession> {
  throw new Error(
    `${STAGE_A_UNAVAILABLE_CODE}: Director Pi runtime is not wired in Stage A`,
  );
}
