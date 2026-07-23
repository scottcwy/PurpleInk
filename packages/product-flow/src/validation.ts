import { ProductFlowVersionV1Schema, type ProductFlowVersionV1 } from "./schemas.ts";

export type FlowValidationIssueCode =
  | "schema_invalid"
  | "node_count"
  | "action_count"
  | "duplicate_node_id"
  | "duplicate_order"
  | "duplicate_action_id"
  | "duplicate_assertion_id"
  | "duplicate_capability_id"
  | "unknown_edge_node"
  | "not_linear"
  | "external_side_effect"
  | "checkpoint_required";

export type FlowValidationIssue = {
  code: FlowValidationIssueCode;
  message: string;
  path?: ReadonlyArray<string | number>;
};

export type FlowValidationResult =
  | { success: true; data: ProductFlowVersionV1 }
  | { success: false; issues: FlowValidationIssue[] };

const duplicateValues = <T>(values: readonly T[]): Set<T> => {
  const seen = new Set<T>();
  const duplicates = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
};

export function validateProductFlowV1(input: unknown): FlowValidationResult {
  const parsed = ProductFlowVersionV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        message: issue.message,
        path: issue.path.map(String),
      })),
    };
  }

  const flow = parsed.data;
  const issues: FlowValidationIssue[] = [];
  const add = (code: FlowValidationIssueCode, message: string, path?: ReadonlyArray<string | number>): void => {
    issues.push(path === undefined ? { code, message } : { code, message, path });
  };

  if (flow.nodes.length < 3 || flow.nodes.length > 8) {
    add("node_count", "ProductFlow V1 must contain between 3 and 8 nodes", ["nodes"]);
  }

  const actionCount = flow.nodes.reduce((total, node) => total + node.actions.length, 0);
  if (actionCount > 100) add("action_count", "ProductFlow V1 cannot contain more than 100 actions", ["nodes"]);

  for (const id of duplicateValues(flow.nodes.map((node) => node.id))) {
    add("duplicate_node_id", `Duplicate node id: ${id}`, ["nodes"]);
  }
  for (const order of duplicateValues(flow.nodes.map((node) => node.order))) {
    add("duplicate_order", `Duplicate node order: ${order}`, ["nodes"]);
  }

  const allActions = flow.nodes.flatMap((node) => node.actions);
  for (const id of duplicateValues(allActions.map((action) => action.id))) {
    add("duplicate_action_id", `Duplicate action id: ${id}`, ["nodes"]);
  }
  const allAssertions = flow.nodes.flatMap((node) => node.checkpoints);
  for (const id of duplicateValues(allAssertions.map((assertion) => assertion.id))) {
    add("duplicate_assertion_id", `Duplicate assertion id: ${id}`, ["nodes"]);
  }

  flow.nodes.forEach((node, nodeIndex) => {
    for (const id of duplicateValues(node.capabilityIds)) {
      add("duplicate_capability_id", `Node contains duplicate capability id: ${id}`, ["nodes", nodeIndex, "capabilityIds"]);
    }
    node.actions.forEach((action, actionIndex) => {
      if (action.effect === "external_side_effect") {
        add("external_side_effect", "External side effects cannot be persisted in ProductFlow V1", ["nodes", nodeIndex, "actions", actionIndex, "effect"]);
      }
    });
    if (node.actions.some((action) => action.effect === "non_idempotent_write") && node.checkpoints.length === 0) {
      add("checkpoint_required", "A node with a non-idempotent write must have a checkpoint", ["nodes", nodeIndex, "checkpoints"]);
    }
  });

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  flow.edges.forEach((edge, edgeIndex) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      add("unknown_edge_node", "Flow edge references an unknown node", ["edges", edgeIndex]);
    }
  });

  const knownEdges = flow.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const incoming = new Map(flow.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(flow.nodes.map((node) => [node.id, 0]));
  for (const edge of knownEdges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
  }

  const sources = flow.nodes.filter((node) => incoming.get(node.id) === 0);
  const sinks = flow.nodes.filter((node) => outgoing.get(node.id) === 0);
  const degreeIsLinear = flow.nodes.every((node) => (incoming.get(node.id) ?? 0) <= 1 && (outgoing.get(node.id) ?? 0) <= 1);
  const orderedNodes = [...flow.nodes].sort((left, right) => left.order - right.order);
  const expectedEdges = new Set(
    orderedNodes.slice(1).map((node, index) => `${orderedNodes[index]!.id}:${node.id}`),
  );
  const actualEdges = new Set(knownEdges.map((edge) => `${edge.from}:${edge.to}`));
  const followsOrder = expectedEdges.size === actualEdges.size && [...expectedEdges].every((edge) => actualEdges.has(edge));
  if (
    flow.edges.length !== Math.max(0, flow.nodes.length - 1) ||
    sources.length !== 1 ||
    sinks.length !== 1 ||
    !degreeIsLinear ||
    !followsOrder
  ) {
    add("not_linear", "ProductFlow V1 must be a connected, acyclic linear graph following node order", ["edges"]);
  }

  return issues.length === 0 ? { success: true, data: flow } : { success: false, issues };
}

export function parseProductFlowV1(input: unknown): ProductFlowVersionV1 {
  const result = validateProductFlowV1(input);
  if (!result.success) {
    throw new ProductFlowValidationError(result.issues);
  }
  return result.data;
}

export class ProductFlowValidationError extends Error {
  readonly issues: readonly FlowValidationIssue[];

  constructor(issues: readonly FlowValidationIssue[]) {
    super(issues.map((issue) => `${issue.code}: ${issue.message}`).join("; "));
    this.name = "ProductFlowValidationError";
    this.issues = issues;
  }
}
