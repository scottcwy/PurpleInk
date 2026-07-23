import validFixture from "./fixtures/product-flow-v1.valid.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
  ApprovedVersionImmutableError,
  CleanReplayRequiredError,
  InMemoryProductFlowVersionRepository,
  ProductFlowVersionService,
  canonicalJson,
  contentHash,
} from "../src/index.ts";

const workspaceId = "60000000-0000-4000-8000-000000000001";
const productFlowId = "70000000-0000-4000-8000-000000000001";
const capabilities = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    workspaceId,
    productId: validFixture.productId,
    name: "Browse projects",
    description: "Users can browse projects.",
    status: "active" as const,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    workspaceId,
    productId: validFixture.productId,
    name: "Create project",
    description: "Users can create a project.",
    status: "active" as const,
  },
];

const createService = () => {
  let sequence = 0;
  const repository = new InMemoryProductFlowVersionRepository();
  const service = new ProductFlowVersionService(repository, {
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    newId: () => `80000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
  return { repository, service };
};

describe("canonical ProductFlow content hashing", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] })).toBe(
      '{"list":[{"x":1,"y":2}],"nested":{"a":1,"b":2},"z":1}',
    );
  });

  it("produces the same lowercase SHA-256 for equivalent key order", async () => {
    const left = await contentHash({ b: 2, a: { d: 4, c: 3 } });
    const right = await contentHash({ a: { c: 3, d: 4 }, b: 2 });

    expect(left).toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("ProductFlowVersionService", () => {
  it("creates validated draft versions with monotonic versions and content hashes", async () => {
    const { service } = createService();

    const first = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "create-flow-v1",
      payload: validFixture,
    });
    const secondPayload = structuredClone(validFixture);
    secondPayload.locale = "ja-JP";
    const second = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "create-flow-v2",
      payload: secondPayload,
    });

    expect(first).toMatchObject({
      workspaceId,
      productFlowId,
      version: 1,
      schemaVersion: "product-flow/v1",
      status: "draft",
      approvedAt: null,
      createdAt: "2026-07-24T00:00:00.000Z",
    });
    expect(second.version).toBe(2);
    expect(first.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it("returns the same version for a repeated idempotency key", async () => {
    const { service } = createService();
    const input = { workspaceId, productFlowId, idempotencyKey: "same-request", payload: validFixture };

    const first = await service.createVersion(input);
    const repeated = await service.createVersion(input);

    expect(repeated).toEqual(first);
    expect((await service.listVersions(productFlowId)).map((version) => version.version)).toEqual([1]);
  });

  it("rejects invalid flow payloads before persistence", async () => {
    const { service } = createService();
    const invalid = structuredClone(validFixture);
    invalid.nodes[2]!.checkpoints = [];

    await expect(
      service.createVersion({ workspaceId, productFlowId, idempotencyKey: "invalid", payload: invalid }),
    ).rejects.toThrow(/checkpoint_required/);
    expect(await service.listVersions(productFlowId)).toEqual([]);
  });

  it("approves a draft and makes its payload deeply immutable", async () => {
    const { service } = createService();
    const draft = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "approve-create",
      payload: validFixture,
    });

    const approved = await service.approveVersion({
      versionId: draft.id,
      idempotencyKey: "approve-v1",
      cleanReplayPassed: true,
      capabilities,
    });

    expect(approved.status).toBe("approved");
    expect(approved.approvedAt).toBe("2026-07-24T00:00:00.000Z");
    expect(() => {
      approved.payload.nodes[0]!.title = "mutated";
    }).toThrow(TypeError);
  });

  it("rejects update and delete after approval while allowing a successor version", async () => {
    const { service } = createService();
    const draft = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "immutable-create",
      payload: validFixture,
    });
    await service.approveVersion({
      versionId: draft.id,
      idempotencyKey: "immutable-approve",
      cleanReplayPassed: true,
      capabilities,
    });

    await expect(
      service.replaceDraft({
        versionId: draft.id,
        idempotencyKey: "immutable-update",
        payload: validFixture,
      }),
    ).rejects.toBeInstanceOf(ApprovedVersionImmutableError);
    await expect(
      service.deleteDraft({ versionId: draft.id, idempotencyKey: "immutable-delete" }),
    ).rejects.toBeInstanceOf(ApprovedVersionImmutableError);

    const successor = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "successor",
      payload: validFixture,
    });
    expect(successor.version).toBe(2);
  });

  it("returns frozen copies so callers cannot mutate repository state", async () => {
    const { service } = createService();
    const draft = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "frozen-copy",
      payload: validFixture,
    });

    expect(() => {
      draft.payload.nodes.pop();
    }).toThrow(TypeError);
    expect((await service.getVersion(draft.id)).payload.nodes).toHaveLength(3);
  });

  it("requires a clean replay before approval", async () => {
    const { service } = createService();
    const draft = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "replay-create",
      payload: validFixture,
    });

    await expect(
      service.approveVersion({
        versionId: draft.id,
        idempotencyKey: "replay-approve",
        cleanReplayPassed: false,
        capabilities,
      }),
    ).rejects.toBeInstanceOf(CleanReplayRequiredError);
  });

  it("rejects approval when a proves capability cannot be resolved", async () => {
    const { service } = createService();
    const draft = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "capability-create",
      payload: validFixture,
    });

    await expect(
      service.approveVersion({
        versionId: draft.id,
        idempotencyKey: "capability-approve",
        cleanReplayPassed: true,
        capabilities: capabilities.slice(0, 1),
      }),
    ).rejects.toThrow(/capability_not_found/);
  });

  it("makes repeated draft deletion idempotent", async () => {
    const { service } = createService();
    const draft = await service.createVersion({
      workspaceId,
      productFlowId,
      idempotencyKey: "delete-create",
      payload: validFixture,
    });
    const input = { versionId: draft.id, idempotencyKey: "delete-draft" };

    await expect(service.deleteDraft(input)).resolves.toBeUndefined();
    await expect(service.deleteDraft(input)).resolves.toBeUndefined();
  });
});
