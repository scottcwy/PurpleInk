import {
  parseProductFlowV1,
  type BrowserActionV1,
  type ProductFlowVersionV1,
} from "@purpleink/product-flow";
import type { CaptureAction, CapturePlan } from "./protocol.js";

export class CapturePlanProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapturePlanProjectionError";
  }
}

type ProjectionValues = {
  fixtures?: Readonly<Record<string, string>>;
  localSecrets?: Readonly<Record<string, string>>;
};

function resolveValue(action: BrowserActionV1, values: ProjectionValues): string | undefined {
  if (!action.value) return undefined;
  if (action.value.kind === "literal") return action.value.value;
  if (action.value.kind === "fixture") {
    const value = values.fixtures?.[action.value.key];
    if (value === undefined) throw new CapturePlanProjectionError(`Missing fixture ${action.value.key}`);
    return value;
  }
  if (action.value.kind === "local_secret") {
    const value = values.localSecrets?.[action.value.key];
    if (value === undefined) throw new CapturePlanProjectionError(`Missing local secret ${action.value.key}`);
    return value;
  }
  throw new CapturePlanProjectionError(`Action ${action.id} requires user handoff`);
}

export function capturePlanFromProductFlow(
  sessionId: string,
  input: unknown,
  values: ProjectionValues = {},
): CapturePlan {
  const flow: ProductFlowVersionV1 = parseProductFlowV1(input);
  const actions: CaptureAction[] = flow.nodes.flatMap((node) => node.actions.map((action) => {
    if (action.effect === "external_side_effect") {
      throw new CapturePlanProjectionError(`Action ${action.id} has a prohibited external side effect`);
    }
    if (action.kind === "upload") {
      throw new CapturePlanProjectionError(`Action ${action.id} requires explicit upload handoff`);
    }
    const projected: CaptureAction = {
      id: action.id,
      kind: action.kind,
      effect: action.effect,
    };
    if (action.target) projected.target = action.target;
    if (action.kind === "navigate") projected.url = action.expectedUrl ?? flow.startUrl;
    const value = resolveValue(action, values);
    if (value !== undefined) projected.value = value;
    return projected;
  }));
  return { sessionId, allowedOrigins: [...flow.allowedOrigins], actions };
}
