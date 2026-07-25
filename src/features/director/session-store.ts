import type { PipelineStage } from "./types";

import { STAGE_A_UNAVAILABLE_CODE } from "./pi-session";

export interface SessionStoreInput {
  projectId: string;
  nodeId: string;
  nodeType?: string | null;
  stage: PipelineStage;
  resumeSessionKey?: string;
}

export interface StoredDirectorSession {
  id: string;
  storageKey: string;
  session: never;
}

/**
 * Pi JSONL session persistence is a Stage B concern. Every entry point throws
 * the same stable error so callers cannot mistake this shell for a real store.
 */
export class DirectorSessionStore {
  async open(_input: SessionStoreInput): Promise<StoredDirectorSession> {
    return this.unavailable();
  }

  async create(
    _input: Omit<SessionStoreInput, "resumeSessionKey">,
  ): Promise<StoredDirectorSession> {
    return this.unavailable();
  }

  async resume(_storageKey: string): Promise<StoredDirectorSession> {
    return this.unavailable();
  }

  async close(): Promise<void> {}

  private unavailable(): never {
    throw new Error(
      `${STAGE_A_UNAVAILABLE_CODE}: Director Pi session storage is not wired in Stage A`,
    );
  }
}
