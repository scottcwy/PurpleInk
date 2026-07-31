import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callWorkerModel,
  synthesizeWorkerSpeech,
} from "../server/src/ai/gateway-client";
import { runWithWorkerAiContext } from "../server/src/ai/job-context";

const identity = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  attemptId: "00000000-0000-4000-8000-000000000002",
  requestId: "website:project:attempt",
};

afterEach(() => {
  delete process.env.PURPLEINK_AI_GATEWAY_ORIGIN;
  delete process.env.PURPLEINK_ENGINE_INTERNAL_KEY;
});

describe("worker AI gateway client", () => {
  it("sends scoped operations without provider routing fields", async () => {
    process.env.PURPLEINK_AI_GATEWAY_ORIGIN = "http://next:3000";
    process.env.PURPLEINK_ENGINE_INTERNAL_KEY = "internal-only";
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        workspaceId: identity.workspaceId,
        attemptId: identity.attemptId,
        operationId: `${identity.requestId}:website-compose:1`,
        operationIndex: 1,
        capability: "text",
        workload: "website-compose",
      });
      expect(body).not.toHaveProperty("provider");
      expect(body).not.toHaveProperty("model");
      expect(body).not.toHaveProperty("baseUrl");
      expect(body).not.toHaveProperty("apiKey");
      return Response.json({ ok: true, capability: "text", text: "done" });
    });

    const result = await runWithWorkerAiContext(identity, () =>
      callWorkerModel({
        workload: "website-compose",
        content: [{ type: "text", text: "compose" }],
        maxOutputTokens: 100,
      }, fetcher));

    expect(result).toBe("done");
  });

  it("decodes TTS bytes returned by the gateway", async () => {
    process.env.PURPLEINK_AI_GATEWAY_ORIGIN = "http://next:3000";
    process.env.PURPLEINK_ENGINE_INTERNAL_KEY = "internal-only";
    const fetcher = vi.fn(async () => Response.json({
      ok: true,
      capability: "tts",
      audioBase64: Buffer.from("RIFFtest").toString("base64"),
      audioFormat: "wav",
      durationMs: 1_000,
    }));

    const result = await runWithWorkerAiContext(identity, () =>
      synthesizeWorkerSpeech("旁白", fetcher));

    expect(Buffer.from(result.audio).toString()).toBe("RIFFtest");
    expect(result.audioFormat).toBe("wav");
  });

  it("fails before fetch when the trusted gateway origin is absent", async () => {
    process.env.PURPLEINK_ENGINE_INTERNAL_KEY = "internal-only";
    const fetcher = vi.fn();

    await expect(runWithWorkerAiContext(identity, () =>
      callWorkerModel({
        workload: "website-compose",
        content: [{ type: "text", text: "compose" }],
        maxOutputTokens: 100,
      }, fetcher))).rejects.toThrow("WORKER_AI_GATEWAY_UNCONFIGURED");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
