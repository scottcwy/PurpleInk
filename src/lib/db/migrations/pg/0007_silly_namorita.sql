CREATE TABLE "managed_model_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"capability" text NOT NULL,
	"minimum_plan_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "managed_model_catalog_identity_unique" UNIQUE("provider","model","capability"),
	CONSTRAINT "managed_model_catalog_plan_check" CHECK ("managed_model_catalog"."minimum_plan_key" in ('free', 'plus', 'pro', 'max'))
);
--> statement-breakpoint
CREATE TABLE "rate_card_units" (
	"rate_card_id" uuid NOT NULL,
	"unit_kind" text NOT NULL,
	"unit_size" bigint NOT NULL,
	"source_price_micros" bigint NOT NULL,
	"unit_price_cny_micros" bigint NOT NULL,
	CONSTRAINT "rate_card_units_pkey" PRIMARY KEY("rate_card_id","unit_kind"),
	CONSTRAINT "rate_card_units_kind_check" CHECK ("rate_card_units"."unit_kind" in (
        'input_token', 'cached_input_token', 'output_token',
        'tts_character', 'audio_second'
      )),
	CONSTRAINT "rate_card_units_amounts_check" CHECK ("rate_card_units"."unit_size" > 0 and "rate_card_units"."source_price_micros" >= 0
        and "rate_card_units"."unit_price_cny_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"price_currency" text NOT NULL,
	"fx_cny_micros_per_currency_unit" bigint NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_cards_catalog_version_unique" UNIQUE("catalog_id","version"),
	CONSTRAINT "rate_cards_version_check" CHECK ("rate_cards"."version" > 0),
	CONSTRAINT "rate_cards_currency_check" CHECK ("rate_cards"."price_currency" in ('CNY', 'USD')),
	CONSTRAINT "rate_cards_fx_check" CHECK ("rate_cards"."fx_cny_micros_per_currency_unit" > 0)
);
--> statement-breakpoint
CREATE TABLE "redemption_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code_id" uuid,
	"actor_user_id" uuid,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"result" text NOT NULL,
	"before_plan_key" text,
	"after_plan_key" text,
	"before_expires_at" timestamp with time zone,
	"after_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_audits_idempotency_unique" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "redemption_audits_result_check" CHECK ("redemption_audits"."result" in (
      'redeemed', 'rejected_lower_tier', 'unavailable'
    )),
	CONSTRAINT "redemption_audits_before_plan_check" CHECK ("redemption_audits"."before_plan_key" is null or "redemption_audits"."before_plan_key" in ('free', 'plus', 'pro', 'max')),
	CONSTRAINT "redemption_audits_after_plan_check" CHECK ("redemption_audits"."after_plan_key" is null or "redemption_audits"."after_plan_key" in ('free', 'plus', 'pro', 'max')),
	CONSTRAINT "redemption_audits_fingerprint_check" CHECK (length("redemption_audits"."request_fingerprint") = 64)
);
--> statement-breakpoint
CREATE TABLE "redemption_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_key" text NOT NULL,
	"duration_days" integer DEFAULT 30 NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_batches_plan_check" CHECK ("redemption_batches"."plan_key" in ('free', 'plus', 'pro', 'max')),
	CONSTRAINT "redemption_batches_duration_check" CHECK ("redemption_batches"."duration_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "redemption_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"consumed_by_workspace_id" uuid,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "redemption_codes_hash_check" CHECK (length("redemption_codes"."code_hash") = 64),
	CONSTRAINT "redemption_codes_consumption_check" CHECK (("redemption_codes"."consumed_by_workspace_id" is null) = ("redemption_codes"."consumed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "usage_periods" (
	"workspace_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"plan_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"limit_cny_micros" bigint NOT NULL,
	"used_cny_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_cny_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_periods_pkey" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "usage_periods_workspace_start_unique" UNIQUE("workspace_id","starts_at"),
	CONSTRAINT "usage_periods_plan_check" CHECK ("usage_periods"."plan_key" in ('free', 'plus', 'pro', 'max')),
	CONSTRAINT "usage_periods_status_check" CHECK ("usage_periods"."status" in ('active', 'closed')),
	CONSTRAINT "usage_periods_period_check" CHECK ("usage_periods"."ends_at" > "usage_periods"."starts_at"),
	CONSTRAINT "usage_periods_amounts_check" CHECK ("usage_periods"."limit_cny_micros" >= 0 and "usage_periods"."used_cny_micros" >= 0
        and "usage_periods"."reserved_cny_micros" >= 0
        and "usage_periods"."used_cny_micros" + "usage_periods"."reserved_cny_micros" <= "usage_periods"."limit_cny_micros")
);
--> statement-breakpoint
CREATE TABLE "workspace_entitlements" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan_key" text DEFAULT 'free' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'default' NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_entitlements_plan_check" CHECK ("workspace_entitlements"."plan_key" in ('free', 'plus', 'pro', 'max')),
	CONSTRAINT "workspace_entitlements_status_check" CHECK ("workspace_entitlements"."status" in ('active', 'expired', 'cancelled')),
	CONSTRAINT "workspace_entitlements_period_check" CHECK ("workspace_entitlements"."expires_at" > "workspace_entitlements"."starts_at"),
	CONSTRAINT "workspace_entitlements_revision_check" CHECK ("workspace_entitlements"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "usage_period_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "rate_card_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "billing_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "billing_status" text DEFAULT 'unreserved' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "reserved_cny_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "settled_cny_micros" bigint;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "usage_status" text;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD COLUMN "settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rate_card_units" ADD CONSTRAINT "rate_card_units_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_catalog_id_managed_model_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."managed_model_catalog"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_audits" ADD CONSTRAINT "redemption_audits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_audits" ADD CONSTRAINT "redemption_audits_code_id_redemption_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."redemption_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_audits" ADD CONSTRAINT "redemption_audits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_batches" ADD CONSTRAINT "redemption_batches_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_codes" ADD CONSTRAINT "redemption_codes_batch_id_redemption_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."redemption_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemption_codes" ADD CONSTRAINT "redemption_codes_consumed_by_workspace_id_workspaces_id_fk" FOREIGN KEY ("consumed_by_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_periods" ADD CONSTRAINT "usage_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_entitlements" ADD CONSTRAINT "workspace_entitlements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_usage_period_fk" FOREIGN KEY ("workspace_id","usage_period_id") REFERENCES "public"."usage_periods"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_billing_idempotency_unique" UNIQUE("workspace_id","billing_idempotency_key");--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_billing_status_check" CHECK ("ai_invocations"."billing_status" in ('unreserved', 'reserved', 'settled', 'released'));--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_billing_amounts_check" CHECK ("ai_invocations"."reserved_cny_micros" >= 0
        and ("ai_invocations"."settled_cny_micros" is null or "ai_invocations"."settled_cny_micros" >= 0));--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_usage_status_check" CHECK ("ai_invocations"."usage_status" is null or "ai_invocations"."usage_status" in ('reported', 'unavailable'));
--> statement-breakpoint
INSERT INTO "managed_model_catalog"
  ("id", "provider", "model", "capability", "minimum_plan_key")
VALUES
  ('10000000-0000-4000-8000-000000000001', 'stepfun', 'step-3.5-flash', 'text', 'free'),
  ('10000000-0000-4000-8000-000000000002', 'stepfun', 'step-3.7-flash', 'vision', 'free'),
  ('10000000-0000-4000-8000-000000000003', 'stepfun', 'stepaudio-2.5-tts', 'tts', 'free'),
  ('10000000-0000-4000-8000-000000000004', 'stepfun', 'stepaudio-2.5-asr', 'asr', 'free'),
  ('10000000-0000-4000-8000-000000000005', 'mimo', 'mimo-v2.5', 'text', 'free'),
  ('10000000-0000-4000-8000-000000000006', 'mimo', 'mimo-v2.5', 'vision', 'free'),
  ('10000000-0000-4000-8000-000000000007', 'mimo', 'mimo-v2.5-tts', 'tts', 'free'),
  ('10000000-0000-4000-8000-000000000008', 'mimo', 'mimo-v2.5-asr', 'asr', 'free'),
  ('10000000-0000-4000-8000-000000000009', 'gemini', 'gemini-3.1-flash-lite', 'text', 'plus'),
  ('10000000-0000-4000-8000-000000000010', 'gemini', 'gemini-3.1-flash-lite', 'vision', 'plus')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "rate_cards"
  ("id", "catalog_id", "version", "price_currency",
   "fx_cny_micros_per_currency_unit", "effective_at")
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000005', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000006', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000007', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-000000000008', 1, 'CNY', 1000000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009', 1, 'USD', 7200000, '2026-07-28T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000010', '10000000-0000-4000-8000-000000000010', 1, 'USD', 7200000, '2026-07-28T00:00:00Z')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "rate_card_units"
  ("rate_card_id", "unit_kind", "unit_size", "source_price_micros", "unit_price_cny_micros")
VALUES
  ('20000000-0000-4000-8000-000000000001', 'input_token', 1000000, 700000, 700000),
  ('20000000-0000-4000-8000-000000000001', 'cached_input_token', 1000000, 140000, 140000),
  ('20000000-0000-4000-8000-000000000001', 'output_token', 1000000, 2100000, 2100000),
  ('20000000-0000-4000-8000-000000000002', 'input_token', 1000000, 1350000, 1350000),
  ('20000000-0000-4000-8000-000000000002', 'cached_input_token', 1000000, 270000, 270000),
  ('20000000-0000-4000-8000-000000000002', 'output_token', 1000000, 8100000, 8100000),
  ('20000000-0000-4000-8000-000000000003', 'tts_character', 10000, 5800000, 5800000),
  ('20000000-0000-4000-8000-000000000004', 'audio_second', 3600, 150000, 150000),
  ('20000000-0000-4000-8000-000000000005', 'input_token', 1000000, 1000000, 1000000),
  ('20000000-0000-4000-8000-000000000005', 'cached_input_token', 1000000, 20000, 20000),
  ('20000000-0000-4000-8000-000000000005', 'output_token', 1000000, 2000000, 2000000),
  ('20000000-0000-4000-8000-000000000006', 'input_token', 1000000, 1000000, 1000000),
  ('20000000-0000-4000-8000-000000000006', 'cached_input_token', 1000000, 20000, 20000),
  ('20000000-0000-4000-8000-000000000006', 'output_token', 1000000, 2000000, 2000000),
  ('20000000-0000-4000-8000-000000000007', 'tts_character', 10000, 0, 0),
  ('20000000-0000-4000-8000-000000000008', 'audio_second', 3600, 500000, 500000),
  ('20000000-0000-4000-8000-000000000009', 'input_token', 1000000, 250000, 1800000),
  ('20000000-0000-4000-8000-000000000009', 'cached_input_token', 1000000, 25000, 180000),
  ('20000000-0000-4000-8000-000000000009', 'output_token', 1000000, 1500000, 10800000),
  ('20000000-0000-4000-8000-000000000010', 'input_token', 1000000, 250000, 1800000),
  ('20000000-0000-4000-8000-000000000010', 'cached_input_token', 1000000, 25000, 180000),
  ('20000000-0000-4000-8000-000000000010', 'output_token', 1000000, 1500000, 10800000)
ON CONFLICT DO NOTHING;
