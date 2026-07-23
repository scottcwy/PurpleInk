import invalidPersistenceFixture from "./fixtures/product-flow-v1.invalid-persistence.json" with { type: "json" };
import validFixture from "./fixtures/product-flow-v1.valid.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
  AssertionV1Schema,
  BrowserActionV1Schema,
  FlowEdgeV1Schema,
  FlowNodeV1Schema,
  LocatorV1Schema,
  ProductFlowVersionV1Schema,
  validateProductFlowV1,
  type ProductFlowVersionV1,
} from "../src/index.ts";

const clone = (): ProductFlowVersionV1 => structuredClone(validFixture) as ProductFlowVersionV1;

describe("ProductFlow DSL V1 schemas", () => {
  it("parses the valid golden fixture through the versioned public schema", () => {
    expect(ProductFlowVersionV1Schema.parse(validFixture)).toEqual(validFixture);
  });

  it("exports each V1 component schema", () => {
    const flow = ProductFlowVersionV1Schema.parse(validFixture);
    expect(LocatorV1Schema.parse(flow.nodes[1]?.actions[0]?.target)).toBeDefined();
    expect(BrowserActionV1Schema.parse(flow.nodes[0]?.actions[0])).toBeDefined();
    expect(AssertionV1Schema.parse(flow.nodes[0]?.checkpoints[0])).toBeDefined();
    expect(FlowNodeV1Schema.parse(flow.nodes[0])).toBeDefined();
    expect(FlowEdgeV1Schema.parse(flow.edges[0])).toBeDefined();
  });

  it("rejects persisted snapshot refs, coordinates, and temporary node ids", () => {
    expect(ProductFlowVersionV1Schema.safeParse(invalidPersistenceFixture).success).toBe(false);
  });

  it("rejects unknown fields instead of silently stripping them", () => {
    expect(LocatorV1Schema.safeParse({ by: "text", value: "Save", backendNodeId: 42 }).success).toBe(false);
  });
});

describe("ProductFlow V1 graph validation", () => {
  it("accepts a linear, connected golden flow", () => {
    expect(validateProductFlowV1(validFixture)).toEqual({ success: true, data: validFixture });
  });

  it("accepts one-based node order because V1 does not prescribe an order origin", () => {
    const flow = clone();
    flow.nodes.forEach((node) => {
      node.order += 1;
    });

    expect(validateProductFlowV1(flow)).toEqual({ success: true, data: flow });
  });

  it.each([2, 9])("rejects a flow with %i nodes", (nodeCount) => {
    const flow = clone();
    flow.nodes = Array.from({ length: nodeCount }, (_, index) => ({
      ...flow.nodes[0]!,
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      order: index,
      actions: [],
      checkpoints: [],
    }));
    flow.edges = flow.nodes.slice(1).map((node, index) => ({ from: flow.nodes[index]!.id, to: node.id }));

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("node_count");
  });

  it("rejects cycles", () => {
    const flow = clone();
    flow.edges.push({ from: flow.nodes[2]!.id, to: flow.nodes[0]!.id });

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("not_linear");
  });

  it("rejects disconnected and branching graphs", () => {
    const flow = clone();
    flow.edges = [
      { from: flow.nodes[0]!.id, to: flow.nodes[1]!.id },
      { from: flow.nodes[0]!.id, to: flow.nodes[2]!.id },
    ];

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("not_linear");
  });

  it("rejects edges that reference unknown nodes", () => {
    const flow = clone();
    flow.edges[1] = { ...flow.edges[1]!, to: "20000000-0000-4000-8000-999999999999" };

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("unknown_edge_node");
  });

  it("rejects more than 100 actions", () => {
    const flow = clone();
    flow.nodes[0]!.actions = Array.from({ length: 101 }, (_, index) => ({
      ...flow.nodes[0]!.actions[0]!,
      id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    }));

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("action_count");
  });

  it("rejects external side effects", () => {
    const flow = clone();
    flow.nodes[0]!.actions[0]!.effect = "external_side_effect";

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("external_side_effect");
  });

  it("requires a checkpoint in a node with a non-idempotent write", () => {
    const flow = clone();
    flow.nodes[2]!.checkpoints = [];

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.issues.map((issue) => issue.code)).toContain("checkpoint_required");
  });

  it("rejects duplicate node, action, assertion, capability, and order identifiers", () => {
    const flow = clone();
    flow.nodes[1]!.id = flow.nodes[0]!.id;
    flow.nodes[1]!.order = flow.nodes[0]!.order;
    flow.nodes[1]!.actions[0]!.id = flow.nodes[0]!.actions[0]!.id;
    flow.nodes[1]!.checkpoints[0]!.id = flow.nodes[0]!.checkpoints[0]!.id;
    flow.nodes[1]!.capabilityIds = [flow.nodes[1]!.capabilityIds[0]!, flow.nodes[1]!.capabilityIds[0]!];

    const result = validateProductFlowV1(flow);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
        expect.objectContaining(new Set(["duplicate_node_id", "duplicate_order", "duplicate_action_id", "duplicate_assertion_id", "duplicate_capability_id"])),
      );
    }
  });
});
