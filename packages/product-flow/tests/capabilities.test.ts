import validFixture from "./fixtures/product-flow-v1.valid.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
  ProductCapabilitySchema,
  resolveFlowCapabilityProofs,
  validateFlowCapabilityProofs,
  type ProductCapability,
} from "../src/index.ts";

const productId = "10000000-0000-4000-8000-000000000001";
const capabilities: ProductCapability[] = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    workspaceId: "60000000-0000-4000-8000-000000000001",
    productId,
    name: "Browse projects",
    description: "Users can browse their existing projects.",
    status: "active",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    workspaceId: "60000000-0000-4000-8000-000000000001",
    productId,
    name: "Create project",
    description: "Users can create a project.",
    status: "active",
  },
];

describe("ProductCapability and FlowNode proves", () => {
  it("parses a product-owned capability", () => {
    expect(ProductCapabilitySchema.parse(capabilities[0])).toEqual(capabilities[0]);
  });

  it("resolves every FlowNode capability id into a proves relationship", () => {
    const result = resolveFlowCapabilityProofs(validFixture, capabilities);

    expect(result).toEqual({
      success: true,
      proofs: [
        { nodeId: validFixture.nodes[0]!.id, capability: capabilities[0] },
        { nodeId: validFixture.nodes[1]!.id, capability: capabilities[1] },
        { nodeId: validFixture.nodes[2]!.id, capability: capabilities[1] },
      ],
    });
  });

  it("allows a FlowNode to prove zero capabilities", () => {
    const flow = structuredClone(validFixture);
    flow.nodes[0]!.capabilityIds = [];

    expect(validateFlowCapabilityProofs(flow, capabilities)).toEqual({ success: true });
  });

  it("rejects an unknown capability reference", () => {
    const flow = structuredClone(validFixture);
    flow.nodes[0]!.capabilityIds = ["30000000-0000-4000-8000-999999999999"];

    expect(validateFlowCapabilityProofs(flow, capabilities)).toEqual({
      success: false,
      issues: [expect.objectContaining({ code: "capability_not_found", nodeId: flow.nodes[0]!.id })],
    });
  });

  it("rejects a capability owned by another product", () => {
    const mismatched = capabilities.map((capability, index) =>
      index === 0
        ? { ...capability, productId: "10000000-0000-4000-8000-000000000099" }
        : capability,
    );

    const result = validateFlowCapabilityProofs(validFixture, mismatched);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("capability_product_mismatch");
  });

  it("rejects duplicate capability records", () => {
    const result = validateFlowCapabilityProofs(validFixture, [...capabilities, capabilities[0]!]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("duplicate_capability_id");
  });
});
