import { z } from "zod";

const BusinessIdSchema = z.uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const TimeoutSchema = z.number().int().nonnegative().max(120_000);

export type LocatorV1 = {
  by: "test_id" | "role" | "label" | "placeholder" | "href" | "text" | "css";
  value: string;
  role?: string | undefined;
  exact?: boolean | undefined;
  scope?: LocatorV1 | undefined;
  frame?: LocatorV1 | undefined;
};

const persistedLocatorValueSchema = NonEmptyTextSchema.refine(
  (value) => !/@ref\b|@ref\s*=|@[a-z]\d+\b/i.test(value),
  "Ego snapshot refs cannot be persisted",
);

export const LocatorV1Schema: z.ZodType<LocatorV1> = z.lazy(() =>
  z.strictObject({
    by: z.enum(["test_id", "role", "label", "placeholder", "href", "text", "css"]),
    value: persistedLocatorValueSchema,
    role: NonEmptyTextSchema.optional(),
    exact: z.boolean().optional(),
    scope: LocatorV1Schema.optional(),
    frame: LocatorV1Schema.optional(),
  }),
);

export const ValueSourceV1Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("literal"), value: z.string() }),
  z.strictObject({ kind: z.literal("fixture"), key: NonEmptyTextSchema }),
  z.strictObject({ kind: z.literal("local_secret"), key: NonEmptyTextSchema }),
  z.strictObject({ kind: z.literal("user_handoff"), prompt: NonEmptyTextSchema }),
]);

export type ValueSourceV1 = z.infer<typeof ValueSourceV1Schema>;

export const BrowserActionV1Schema = z.strictObject({
  id: BusinessIdSchema,
  kind: z.enum(["navigate", "click", "fill", "select", "keypress", "upload", "wait_for"]),
  target: LocatorV1Schema.optional(),
  value: ValueSourceV1Schema.optional(),
  expectedUrl: z.url().optional(),
  timeoutMs: TimeoutSchema,
  effect: z.enum(["read", "idempotent_write", "non_idempotent_write", "external_side_effect"]),
});

export type BrowserActionV1 = z.infer<typeof BrowserActionV1Schema>;

export const AssertionV1Schema = z.strictObject({
  id: BusinessIdSchema,
  kind: z.enum(["visible", "hidden", "text_contains", "value_equals", "count_equals", "url_matches"]),
  target: LocatorV1Schema.optional(),
  expected: z.union([z.string(), z.number()]).optional(),
  timeoutMs: TimeoutSchema,
});

export type AssertionV1 = z.infer<typeof AssertionV1Schema>;

export const FlowNodeV1Schema = z.strictObject({
  id: BusinessIdSchema,
  order: z.number().int().nonnegative(),
  title: NonEmptyTextSchema,
  intent: NonEmptyTextSchema,
  capabilityIds: z.array(BusinessIdSchema),
  actions: z.array(BrowserActionV1Schema),
  checkpoints: z.array(AssertionV1Schema),
});

export type FlowNodeV1 = z.infer<typeof FlowNodeV1Schema>;

export const FlowEdgeV1Schema = z.strictObject({
  from: BusinessIdSchema,
  to: BusinessIdSchema,
});

export type FlowEdgeV1 = z.infer<typeof FlowEdgeV1Schema>;

const OriginSchema = z.url().refine((value) => new URL(value).origin === value, "Must be an origin without a path");

export const ProductFlowVersionV1Schema = z.strictObject({
  schemaVersion: z.literal("product-flow/v1"),
  productId: BusinessIdSchema,
  startUrl: z.url(),
  allowedOrigins: z.array(OriginSchema).min(1),
  viewport: z.strictObject({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive(),
  }),
  locale: NonEmptyTextSchema,
  timezone: NonEmptyTextSchema,
  nodes: z.array(FlowNodeV1Schema),
  edges: z.array(FlowEdgeV1Schema),
});

export type ProductFlowVersionV1 = z.infer<typeof ProductFlowVersionV1Schema>;
