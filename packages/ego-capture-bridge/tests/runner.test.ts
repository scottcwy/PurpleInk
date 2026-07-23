import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CaptureRunner,
  MockBrowserAdapter,
  capturePlanFromProductFlow,
  type CaptureAction,
} from "../src/index.js";
const flowFixture: unknown = JSON.parse(readFileSync(new URL("../../product-flow/tests/fixtures/product-flow-v1.valid.json", import.meta.url), "utf8"));

describe("CaptureRunner", () => {
  it("projects the approved ProductFlow contract into a Bridge execution plan", () => {
    const plan = capturePlanFromProductFlow("40000000-0000-4000-8000-000000000010", flowFixture, {
      fixtures: { "draft-project-name": "Golden draft" },
    });

    expect(plan.allowedOrigins).toEqual(["https://app.example.com"]);
    expect(plan.actions.map((action) => action.id)).toEqual([
      "40000000-0000-4000-8000-000000000001",
      "40000000-0000-4000-8000-000000000002",
      "40000000-0000-4000-8000-000000000003",
    ]);
    expect(plan.actions[0]).toMatchObject({ kind: "navigate", url: "https://app.example.com/projects" });
    expect(plan.actions[1]).toMatchObject({ value: "Golden draft" });
  });
  it("executes a mock browser happy path and emits monotonic events", async () => {
    const adapter = new MockBrowserAdapter();
    const events: Array<{ seq: number; type: string }> = [];
    const runner = new CaptureRunner(
      adapter,
      (event) => {
        events.push({ seq: event.seq, type: event.type });
      },
      async () => ["203.0.113.8"],
    );

    const result = await runner.run({
      sessionId: "session-1",
      allowedOrigins: ["https://app.example.com"],
      actions: [
        {
          id: "navigate",
          kind: "navigate",
          url: "https://app.example.com/dashboard",
          effect: "read",
        },
        {
          id: "open-settings",
          kind: "click",
          target: { by: "role", value: "Settings", role: "button" },
          effect: "read",
        },
      ],
    });

    expect(result.state).toBe("completed");
    expect(adapter.executedActionIds).toEqual(["navigate", "open-settings"]);
    expect(events.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
  });

  it("does not repeat a non-idempotent action after disconnect", async () => {
    const action: CaptureAction = {
      id: "create-project",
      kind: "click",
      target: { by: "role", value: "Create project", role: "button" },
      effect: "non_idempotent_write",
    };
    const adapter = new MockBrowserAdapter({
      disconnectAfterActionId: action.id,
      postconditions: { [action.id]: false },
    });
    const runner = new CaptureRunner(adapter, () => undefined);

    const first = await runner.run({
      sessionId: "session-2",
      allowedOrigins: ["https://app.example.com"],
      actions: [action],
    });
    expect(first.state).toBe("disconnected");

    const resumed = await runner.resume();
    expect(resumed.state).toBe("awaiting_user");
    expect(adapter.executedActionIds).toEqual([action.id]);
  });

  it("continues without replay when the disconnected action postcondition passed", async () => {
    const action: CaptureAction = {
      id: "create-project",
      kind: "click",
      target: { by: "role", value: "Create project", role: "button" },
      effect: "non_idempotent_write",
    };
    const adapter = new MockBrowserAdapter({
      disconnectAfterActionId: action.id,
      postconditions: { [action.id]: true },
    });
    const runner = new CaptureRunner(adapter, () => undefined);

    await runner.run({
      sessionId: "session-3",
      allowedOrigins: ["https://app.example.com"],
      actions: [action],
    });
    const resumed = await runner.resume();

    expect(resumed.state).toBe("completed");
    expect(adapter.executedActionIds).toEqual([action.id]);
  });
});
