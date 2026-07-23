import { describe, expect, it } from "vitest";

import {
  approveFlow,
  deleteFlowNode,
  moveFlowNode,
  renameFlowNode,
  rerunFlowNode,
} from "@/lib/product-flow/domain";
import { mockFlow } from "@/tests/fixtures/product-flow";

describe("ProductFlow commands", () => {
  it("moves semantic nodes and rewrites their order", () => {
    const result = moveFlowNode(mockFlow, "node-share", -1);

    expect(result.ok).toBe(true);
    expect(result.flow.nodes.map((node) => [node.id, node.order])).toEqual([
      ["node-create", 1],
      ["node-share", 2],
      ["node-review", 3],
      ["node-insights", 4],
    ]);
  });

  it("renames a node without changing its browser actions", () => {
    const originalActions = mockFlow.nodes[0]?.actions;
    const result = renameFlowNode(mockFlow, "node-create", "Create a campaign");

    expect(result.ok).toBe(true);
    expect(result.flow.nodes[0]?.title).toBe("Create a campaign");
    expect(result.flow.nodes[0]?.actions).toEqual(originalActions);
  });

  it("refuses to delete below the three-node domain minimum", () => {
    const threeNodeFlow = { ...mockFlow, nodes: mockFlow.nodes.slice(0, 3) };
    const result = deleteFlowNode(threeNodeFlow, "node-create");

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("FLOW_MIN_NODES");
  });

  it("creates a fresh node execution when rerunning", () => {
    const result = rerunFlowNode(mockFlow, "node-review");

    expect(result.ok).toBe(true);
    expect(result.execution?.nodeId).toBe("node-review");
    expect(result.execution?.status).toBe("running");
  });

  it("returns domain errors instead of approving an invalid draft", () => {
    const invalid = {
      ...mockFlow,
      nodes: mockFlow.nodes.map((node, index) =>
        index === 0 ? { ...node, checkpoints: [] } : node,
      ),
    };
    const result = approveFlow(invalid);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("CHECKPOINT_REQUIRED");
  });
});
