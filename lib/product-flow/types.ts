export type ExecutionStatus = "passed" | "running" | "failed" | "pending";

export type Locator = {
  by: "test_id" | "role" | "label" | "placeholder" | "href" | "text" | "css";
  value: string;
  role?: string;
};

export type BrowserAction = {
  id: string;
  kind: "navigate" | "click" | "fill" | "select" | "keypress" | "upload" | "wait_for";
  label: string;
  target?: Locator;
  effect: "read" | "idempotent_write" | "non_idempotent_write" | "external_side_effect";
};

export type Assertion = {
  id: string;
  kind: "visible" | "hidden" | "text_contains" | "value_equals" | "count_equals" | "url_matches";
  label: string;
  status: "passed" | "failed";
};

export type Evidence = {
  id: string;
  kind: "result_screenshot" | "node_clip" | "assertion_report" | "dom_summary";
  label: string;
  status: "approved" | "needs_review";
};

export type FlowNode = {
  id: string;
  order: number;
  title: string;
  intent: string;
  capabilityIds: string[];
  actions: BrowserAction[];
  checkpoints: Assertion[];
  evidence: Evidence[];
  execution: {
    status: ExecutionStatus;
    duration: string;
    error?: { code: string; message: string };
  };
};

export type ProductFlow = {
  id: string;
  productId: string;
  name: string;
  version: number;
  status: "draft" | "approved";
  startUrl: string;
  updatedAt: string;
  nodes: FlowNode[];
};

export type FlowCommandError = { code: string; message: string };

export type FlowCommandResult = {
  ok: boolean;
  flow: ProductFlow;
  error?: FlowCommandError;
  execution?: { id: string; nodeId: string; status: ExecutionStatus };
};
