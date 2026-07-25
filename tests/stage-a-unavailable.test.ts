import { describe, expect, it } from "vitest";

import { createDirectorSession } from "@/features/director/pi-session";

describe("Stage A 不可用能力", () => {
  it("Director Pi 会话显式返回 NOT_AVAILABLE_STAGE_A", async () => {
    await expect(
      createDirectorSession({
        projectId: "project-stage-a",
        nodeId: "node-stage-a",
        stage: "DIRECT",
      }),
    ).rejects.toThrow("NOT_AVAILABLE_STAGE_A");
  });
});
