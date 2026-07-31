CREATE TABLE "billing_fx_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"currency" text NOT NULL,
	"cny_micros_per_currency_unit" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"source_url" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_fx_rates_amount_check" CHECK ("billing_fx_rates"."cny_micros_per_currency_unit" > 0),
	CONSTRAINT "billing_fx_rates_period_check" CHECK ("billing_fx_rates"."effective_to" is null or "billing_fx_rates"."effective_to" > "billing_fx_rates"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "billing_reservations" (
	"workspace_id" uuid NOT NULL,
	"invocation_id" uuid NOT NULL,
	"usage_period_id" uuid NOT NULL,
	"maximum_cny_micros" bigint NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"idempotency_key" text NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "billing_reservations_pkey" PRIMARY KEY("workspace_id","invocation_id"),
	CONSTRAINT "billing_reservations_idempotency_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "billing_reservations_amount_check" CHECK ("billing_reservations"."maximum_cny_micros" >= 0),
	CONSTRAINT "billing_reservations_status_check" CHECK ("billing_reservations"."status" in ('reserved', 'settled', 'released', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "entitlement_ledger_entries" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"invocation_id" uuid NOT NULL,
	"usage_period_id" uuid NOT NULL,
	"service_multiplier_id" text NOT NULL,
	"multiplier_numerator" bigint NOT NULL,
	"multiplier_denominator" bigint NOT NULL,
	"debit_cny_micros" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_ledger_entries_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "entitlement_ledger_entries_invocation_unique" UNIQUE("workspace_id","invocation_id"),
	CONSTRAINT "entitlement_ledger_entries_idempotency_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "entitlement_ledger_entries_amount_check" CHECK ("entitlement_ledger_entries"."debit_cny_micros" >= 0
        and "entitlement_ledger_entries"."multiplier_numerator" >= 0
        and "entitlement_ledger_entries"."multiplier_denominator" > 0),
	CONSTRAINT "entitlement_ledger_entries_type_check" CHECK ("entitlement_ledger_entries"."entry_type" in ('debit', 'release', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "official_cost_entries" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"invocation_id" uuid NOT NULL,
	"rate_card_id" uuid NOT NULL,
	"official_price_identity" text NOT NULL,
	"currency" text NOT NULL,
	"source_amount_micros" bigint,
	"fx_rate_version" text,
	"cny_micros" bigint,
	"measurement_quality" text NOT NULL,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "official_cost_entries_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "official_cost_entries_invocation_unique" UNIQUE("workspace_id","invocation_id"),
	CONSTRAINT "official_cost_entries_quality_check" CHECK ("official_cost_entries"."measurement_quality" in ('reported', 'estimated', 'uncertain', 'legacy_unknown')),
	CONSTRAINT "official_cost_entries_amount_check" CHECK (("official_cost_entries"."source_amount_micros" is null or "official_cost_entries"."source_amount_micros" >= 0)
        and ("official_cost_entries"."cny_micros" is null or "official_cost_entries"."cny_micros" >= 0))
);
--> statement-breakpoint
CREATE TABLE "service_multiplier_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"capability" text NOT NULL,
	"numerator" bigint NOT NULL,
	"denominator" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_multiplier_cards_ratio_check" CHECK ("service_multiplier_cards"."numerator" >= 0 and "service_multiplier_cards"."denominator" > 0),
	CONSTRAINT "service_multiplier_cards_period_check" CHECK ("service_multiplier_cards"."effective_to" is null or "service_multiplier_cards"."effective_to" > "service_multiplier_cards"."effective_from")
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "operation_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "attempt_group_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "logical_model_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "outbound_model_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "deployment_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "adapter_protocol" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "official_price_identity" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "provider_pool_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "failure_domain_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "plan_version" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "entitlement_rate_card_id" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "measurement_quality" text;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "catalog_version" text;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "official_price_identity" text;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "retrieved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "fx_rate_version" text;--> statement-breakpoint
ALTER TABLE "usage_periods" ADD COLUMN "plan_version" text DEFAULT 'legacy.v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_periods" ADD COLUMN "concurrency_limit" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_periods" ADD COLUMN "managed_providers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_reservations" ADD CONSTRAINT "billing_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reservations" ADD CONSTRAINT "billing_reservations_invocation_fk" FOREIGN KEY ("workspace_id","invocation_id") REFERENCES "public"."ai_invocations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_reservations" ADD CONSTRAINT "billing_reservations_period_fk" FOREIGN KEY ("workspace_id","usage_period_id") REFERENCES "public"."usage_periods"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_ledger_entries" ADD CONSTRAINT "entitlement_ledger_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_ledger_entries" ADD CONSTRAINT "entitlement_ledger_entries_service_multiplier_id_service_multiplier_cards_id_fk" FOREIGN KEY ("service_multiplier_id") REFERENCES "public"."service_multiplier_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_ledger_entries" ADD CONSTRAINT "entitlement_ledger_entries_invocation_fk" FOREIGN KEY ("workspace_id","invocation_id") REFERENCES "public"."ai_invocations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_ledger_entries" ADD CONSTRAINT "entitlement_ledger_entries_period_fk" FOREIGN KEY ("workspace_id","usage_period_id") REFERENCES "public"."usage_periods"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_cost_entries" ADD CONSTRAINT "official_cost_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_cost_entries" ADD CONSTRAINT "official_cost_entries_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_cost_entries" ADD CONSTRAINT "official_cost_entries_invocation_fk" FOREIGN KEY ("workspace_id","invocation_id") REFERENCES "public"."ai_invocations"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_measurement_quality_check" CHECK ("ai_invocations"."measurement_quality" is null or "ai_invocations"."measurement_quality" in (
        'reported', 'estimated', 'uncertain', 'legacy_unknown'
      ));--> statement-breakpoint
ALTER TABLE "usage_periods" ADD CONSTRAINT "usage_periods_concurrency_check" CHECK ("usage_periods"."concurrency_limit" > 0);
--> statement-breakpoint
INSERT INTO "billing_fx_rates"
  ("id", "currency", "cny_micros_per_currency_unit", "effective_from", "source_url", "retrieved_at")
VALUES
  ('usd-cny-2026-07', 'USD', 7200000, '2026-07-01T00:00:00Z',
   'internal://purpleink/manual-reference-fx', '2026-07-31T00:00:00Z')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "service_multiplier_cards"
  ("id", "capability", "numerator", "denominator", "effective_from")
VALUES
  ('ai.text.v1', 'text', 1, 1, '2026-07-31T00:00:00Z'),
  ('ai.vision.v1', 'vision', 1, 1, '2026-07-31T00:00:00Z'),
  ('ai.tts.v1', 'tts', 1, 1, '2026-07-31T00:00:00Z'),
  ('ai.asr.v1', 'asr', 1, 1, '2026-07-31T00:00:00Z'),
  ('workflow.video.v1', 'workflow', 1, 1, '2026-07-31T00:00:00Z')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "managed_model_catalog"
  ("id", "provider", "model", "capability", "minimum_plan_key")
VALUES
  ('10000000-0000-4000-8000-000000000012', 'stepfun', 'step-3.7-flash', 'text', 'free'),
  ('10000000-0000-4000-8000-000000000013', 'gemini', 'gemini-3.6-flash', 'text', 'plus'),
  ('10000000-0000-4000-8000-000000000014', 'gemini', 'gemini-3.6-flash', 'vision', 'plus'),
  ('10000000-0000-4000-8000-000000000015', 'openai', 'gpt-5.6-luna', 'text', 'pro'),
  ('10000000-0000-4000-8000-000000000016', 'openai', 'gpt-5.6-luna', 'vision', 'pro'),
  ('10000000-0000-4000-8000-000000000017', 'anthropic', 'claude-sonnet-5', 'text', 'pro'),
  ('10000000-0000-4000-8000-000000000018', 'anthropic', 'claude-sonnet-5', 'vision', 'pro')
ON CONFLICT ("provider", "model", "capability") DO UPDATE SET
  "minimum_plan_key" = EXCLUDED."minimum_plan_key",
  "enabled" = true,
  "updated_at" = now();
--> statement-breakpoint
INSERT INTO "rate_cards"
  (
    "id", "catalog_id", "version", "price_currency",
    "fx_cny_micros_per_currency_unit", "effective_at", "retired_at",
    "catalog_version", "official_price_identity", "source_url",
    "retrieved_at", "fx_rate_version"
  )
VALUES
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', 1,
   'CNY', 1000000, '2026-07-31T00:00:00Z', NULL, '2026-07-31.1',
   'stepfun.step-3.7-flash', 'https://platform.stepfun.com', '2026-07-31T00:00:00Z', NULL),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000013', 1,
   'USD', 7200000, '2026-07-31T00:00:00Z', NULL, '2026-07-31.1',
   'google.gemini-3.6-flash', 'https://ai.google.dev/gemini-api/docs/pricing',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07'),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000014', 1,
   'USD', 7200000, '2026-07-31T00:00:00Z', NULL, '2026-07-31.1',
   'google.gemini-3.6-flash', 'https://ai.google.dev/gemini-api/docs/pricing',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07'),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000015', 1,
   'USD', 7200000, '2026-07-31T00:00:00Z', NULL, '2026-07-31.1',
   'openai.gpt-5.6-luna', 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07'),
  ('20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000016', 1,
   'USD', 7200000, '2026-07-31T00:00:00Z', NULL, '2026-07-31.1',
   'openai.gpt-5.6-luna', 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07'),
  ('20000000-0000-4000-8000-000000000017', '10000000-0000-4000-8000-000000000017', 1,
   'USD', 7200000, '2026-06-30T00:00:00Z', '2026-09-01T00:00:00Z', '2026-07-31.1',
   'anthropic.claude-sonnet-5', 'https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07'),
  ('20000000-0000-4000-8000-000000000018', '10000000-0000-4000-8000-000000000018', 1,
   'USD', 7200000, '2026-06-30T00:00:00Z', '2026-09-01T00:00:00Z', '2026-07-31.1',
   'anthropic.claude-sonnet-5', 'https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07')
ON CONFLICT ("catalog_id", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "rate_cards"
  (
    "id", "catalog_id", "version", "price_currency",
    "fx_cny_micros_per_currency_unit", "effective_at",
    "catalog_version", "official_price_identity", "source_url",
    "retrieved_at", "fx_rate_version"
  )
VALUES
  ('20000000-0000-4000-8000-000000000019', '10000000-0000-4000-8000-000000000017', 2,
   'USD', 7200000, '2026-09-01T00:00:00Z', '2026-07-31.1',
   'anthropic.claude-sonnet-5', 'https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07'),
  ('20000000-0000-4000-8000-000000000020', '10000000-0000-4000-8000-000000000018', 2,
   'USD', 7200000, '2026-09-01T00:00:00Z', '2026-07-31.1',
   'anthropic.claude-sonnet-5', 'https://platform.claude.com/docs/en/about-claude/models/whats-new-sonnet-5',
   '2026-07-31T00:00:00Z', 'usd-cny-2026-07')
ON CONFLICT ("catalog_id", "version") DO NOTHING;
--> statement-breakpoint
INSERT INTO "rate_card_units"
  ("rate_card_id", "unit_kind", "unit_size", "source_price_micros", "unit_price_cny_micros")
VALUES
  ('20000000-0000-4000-8000-000000000012', 'input_token', 1000000, 1350000, 1350000),
  ('20000000-0000-4000-8000-000000000012', 'cached_input_token', 1000000, 270000, 270000),
  ('20000000-0000-4000-8000-000000000012', 'output_token', 1000000, 8100000, 8100000),
  ('20000000-0000-4000-8000-000000000013', 'input_token', 1000000, 1500000, 10800000),
  ('20000000-0000-4000-8000-000000000013', 'output_token', 1000000, 7500000, 54000000),
  ('20000000-0000-4000-8000-000000000014', 'input_token', 1000000, 1500000, 10800000),
  ('20000000-0000-4000-8000-000000000014', 'output_token', 1000000, 7500000, 54000000),
  ('20000000-0000-4000-8000-000000000015', 'input_token', 1000000, 1000000, 7200000),
  ('20000000-0000-4000-8000-000000000015', 'cached_input_token', 1000000, 100000, 720000),
  ('20000000-0000-4000-8000-000000000015', 'output_token', 1000000, 6000000, 43200000),
  ('20000000-0000-4000-8000-000000000016', 'input_token', 1000000, 1000000, 7200000),
  ('20000000-0000-4000-8000-000000000016', 'cached_input_token', 1000000, 100000, 720000),
  ('20000000-0000-4000-8000-000000000016', 'output_token', 1000000, 6000000, 43200000),
  ('20000000-0000-4000-8000-000000000017', 'input_token', 1000000, 2000000, 14400000),
  ('20000000-0000-4000-8000-000000000017', 'output_token', 1000000, 10000000, 72000000),
  ('20000000-0000-4000-8000-000000000018', 'input_token', 1000000, 2000000, 14400000),
  ('20000000-0000-4000-8000-000000000018', 'output_token', 1000000, 10000000, 72000000),
  ('20000000-0000-4000-8000-000000000019', 'input_token', 1000000, 3000000, 21600000),
  ('20000000-0000-4000-8000-000000000019', 'output_token', 1000000, 15000000, 108000000),
  ('20000000-0000-4000-8000-000000000020', 'input_token', 1000000, 3000000, 21600000),
  ('20000000-0000-4000-8000-000000000020', 'output_token', 1000000, 15000000, 108000000)
ON CONFLICT ("rate_card_id", "unit_kind") DO NOTHING;
--> statement-breakpoint
UPDATE "rate_cards"
SET
  "catalog_version" = COALESCE("catalog_version", 'legacy.v1'),
  "retrieved_at" = COALESCE("retrieved_at", "created_at")
WHERE "catalog_version" IS NULL OR "retrieved_at" IS NULL;
--> statement-breakpoint
UPDATE "rate_cards"
SET "retired_at" = LEAST(
  COALESCE("retired_at", '2026-09-01T00:00:00Z'::timestamptz),
  '2026-09-01T00:00:00Z'::timestamptz
)
WHERE "id" = '20000000-0000-4000-8000-000000000007';
--> statement-breakpoint
UPDATE "usage_periods"
SET
  "plan_version" = CASE
    WHEN "plan_version" = 'legacy.v1' THEN 'legacy.v1'
    ELSE "plan_version"
  END,
  "concurrency_limit" = CASE "plan_key"
    WHEN 'free' THEN 3
    WHEN 'plus' THEN 20
    WHEN 'pro' THEN 50
    WHEN 'max' THEN 100
  END,
  "managed_providers" = CASE "plan_key"
    WHEN 'free' THEN '["stepfun","mimo"]'::jsonb
    WHEN 'plus' THEN '["stepfun","mimo","gemini"]'::jsonb
    ELSE '["stepfun","mimo","gemini","openai","anthropic"]'::jsonb
  END;
