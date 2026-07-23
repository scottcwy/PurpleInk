import { z } from "zod";

import { ProductFlowVersionV1Schema } from "./schemas.ts";

export const ProductCapabilitySchema = z.strictObject({
  id: z.uuid(),
  workspaceId: z.uuid(),
  productId: z.uuid(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: z.enum(["active", "archived"]),
});

export type ProductCapability = z.infer<typeof ProductCapabilitySchema>;

export type CapabilityProofIssueCode =
  | "flow_schema_invalid"
  | "capability_invalid"
  | "duplicate_capability_id"
  | "capability_not_found"
  | "capability_product_mismatch";

export type CapabilityProofIssue = {
  code: CapabilityProofIssueCode;
  message: string;
  nodeId?: string;
  capabilityId?: string;
};

export type CapabilityProofValidationResult =
  | { success: true }
  | { success: false; issues: CapabilityProofIssue[] };

export type FlowNodeCapabilityProof = {
  nodeId: string;
  capability: ProductCapability;
};

export type CapabilityProofResolutionResult =
  | { success: true; proofs: FlowNodeCapabilityProof[] }
  | { success: false; issues: CapabilityProofIssue[] };

export function validateFlowCapabilityProofs(
  flowInput: unknown,
  capabilityInputs: readonly unknown[],
): CapabilityProofValidationResult {
  const flowResult = ProductFlowVersionV1Schema.safeParse(flowInput);
  if (!flowResult.success) {
    return {
      success: false,
      issues: [{ code: "flow_schema_invalid", message: "Flow payload does not match product-flow/v1" }],
    };
  }

  const issues: CapabilityProofIssue[] = [];
  const capabilities: ProductCapability[] = [];
  for (const input of capabilityInputs) {
    const result = ProductCapabilitySchema.safeParse(input);
    if (result.success) capabilities.push(result.data);
    else issues.push({ code: "capability_invalid", message: result.error.message });
  }

  const capabilitiesById = new Map<string, ProductCapability>();
  for (const capability of capabilities) {
    if (capabilitiesById.has(capability.id)) {
      issues.push({
        code: "duplicate_capability_id",
        message: `Duplicate ProductCapability: ${capability.id}`,
        capabilityId: capability.id,
      });
    } else {
      capabilitiesById.set(capability.id, capability);
    }
  }

  for (const node of flowResult.data.nodes) {
    for (const capabilityId of node.capabilityIds) {
      const capability = capabilitiesById.get(capabilityId);
      if (capability === undefined) {
        issues.push({
          code: "capability_not_found",
          message: `FlowNode references an unknown ProductCapability: ${capabilityId}`,
          nodeId: node.id,
          capabilityId,
        });
      } else if (capability.productId !== flowResult.data.productId) {
        issues.push({
          code: "capability_product_mismatch",
          message: `FlowNode and ProductCapability must belong to the same Product: ${capabilityId}`,
          nodeId: node.id,
          capabilityId,
        });
      }
    }
  }

  return issues.length === 0 ? { success: true } : { success: false, issues };
}

export function resolveFlowCapabilityProofs(
  flowInput: unknown,
  capabilityInputs: readonly unknown[],
): CapabilityProofResolutionResult {
  const validation = validateFlowCapabilityProofs(flowInput, capabilityInputs);
  if (!validation.success) return validation;

  const flow = ProductFlowVersionV1Schema.parse(flowInput);
  const capabilitiesById = new Map(
    capabilityInputs.map((input) => {
      const capability = ProductCapabilitySchema.parse(input);
      return [capability.id, capability] as const;
    }),
  );
  const proofs = flow.nodes.flatMap((node) =>
    node.capabilityIds.map((capabilityId) => ({
      nodeId: node.id,
      capability: capabilitiesById.get(capabilityId)!,
    })),
  );
  return { success: true, proofs };
}
