import type { FlowCommandError, FlowCommandResult, ProductFlow } from "./types";

function result(flow: ProductFlow, error?: FlowCommandError): FlowCommandResult {
  return error ? { ok: false, flow, error } : { ok: true, flow };
}

function replaceNodes(flow: ProductFlow, nodes: ProductFlow["nodes"]): ProductFlow {
  return { ...flow, status: "draft", nodes: nodes.map((node, index) => ({ ...node, order: index + 1 })) };
}

export function moveFlowNode(flow: ProductFlow, nodeId: string, delta: -1 | 1): FlowCommandResult {
  const index = flow.nodes.findIndex((node) => node.id === nodeId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= flow.nodes.length) {
    return result(flow, { code: "MOVE_OUT_OF_RANGE", message: "This node is already at the edge of the flow." });
  }
  const nodes = [...flow.nodes];
  const [node] = nodes.splice(index, 1);
  if (!node) return result(flow, { code: "NODE_NOT_FOUND", message: "The flow node no longer exists." });
  nodes.splice(target, 0, node);
  return result(replaceNodes(flow, nodes));
}

export function renameFlowNode(flow: ProductFlow, nodeId: string, title: string): FlowCommandResult {
  const normalized = title.trim();
  if (!normalized) return result(flow, { code: "TITLE_REQUIRED", message: "A semantic node title is required." });
  return result({ ...flow, status: "draft", nodes: flow.nodes.map((node) => node.id === nodeId ? { ...node, title: normalized } : node) });
}

export function deleteFlowNode(flow: ProductFlow, nodeId: string): FlowCommandResult {
  if (flow.nodes.length <= 3) return result(flow, { code: "FLOW_MIN_NODES", message: "Approved flows require at least three semantic nodes." });
  return result(replaceNodes(flow, flow.nodes.filter((node) => node.id !== nodeId)));
}

export function rerunFlowNode(flow: ProductFlow, nodeId: string): FlowCommandResult {
  if (!flow.nodes.some((node) => node.id === nodeId)) return result(flow, { code: "NODE_NOT_FOUND", message: "The flow node no longer exists." });
  return { ok: true, flow: { ...flow, nodes: flow.nodes.map((node) => node.id === nodeId ? { ...node, execution: { status: "running", duration: "0.0s" } } : node) }, execution: { id: `exec-${nodeId}-${flow.version + 1}`, nodeId, status: "running" } };
}

export function approveFlow(flow: ProductFlow): FlowCommandResult {
  if (flow.nodes.some((node) => node.checkpoints.length === 0)) return result(flow, { code: "CHECKPOINT_REQUIRED", message: "Every semantic node needs at least one checkpoint before approval." });
  if (flow.nodes.some((node) => node.checkpoints.some((checkpoint) => checkpoint.status === "failed"))) return result(flow, { code: "CHECKPOINT_FAILED", message: "Resolve failed checkpoints before approving this version." });
  return result({ ...flow, status: "approved" });
}
