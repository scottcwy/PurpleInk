UPDATE "ai_invocations" AS invocation
SET
  "operation_id" = COALESCE(invocation."operation_id", 'legacy:' || invocation."id"::text),
  "attempt_group_id" = COALESCE(invocation."attempt_group_id", invocation."attempt_id"),
  "logical_model_id" = COALESCE(invocation."logical_model_id", invocation."model"),
  "outbound_model_id" = COALESCE(invocation."outbound_model_id", invocation."model"),
  "official_price_identity" = COALESCE(
    invocation."official_price_identity",
    card."official_price_identity"
  ),
  "plan_version" = COALESCE(invocation."plan_version", period."plan_version"),
  "entitlement_rate_card_id" = COALESCE(
    invocation."entitlement_rate_card_id",
    CASE
      WHEN invocation."capability" = 'workflow' THEN 'workflow.video.v1'
      ELSE 'ai.' || COALESCE(invocation."capability", 'text') || '.v1'
    END
  ),
  "measurement_quality" = COALESCE(
    invocation."measurement_quality",
    CASE
      WHEN invocation."billing_status" IN ('settled', 'released') THEN 'legacy_unknown'
      ELSE NULL
    END
  )
FROM "rate_cards" AS card, "usage_periods" AS period
WHERE invocation."rate_card_id" = card."id"
  AND invocation."workspace_id" = period."workspace_id"
  AND invocation."usage_period_id" = period."id"
  AND invocation."funding" = 'managed';
--> statement-breakpoint
INSERT INTO "billing_reservations"
  (
    "workspace_id", "invocation_id", "usage_period_id",
    "maximum_cny_micros", "status", "idempotency_key",
    "reserved_at", "finalized_at"
  )
SELECT
  invocation."workspace_id",
  invocation."id",
  invocation."usage_period_id",
  GREATEST(
    invocation."reserved_cny_micros",
    COALESCE(invocation."settled_cny_micros", 0)
  ),
  CASE invocation."billing_status"
    WHEN 'settled' THEN 'settled'
    WHEN 'released' THEN 'released'
    ELSE 'reserved'
  END,
  COALESCE(
    invocation."billing_idempotency_key",
    'legacy:' || invocation."id"::text
  ),
  invocation."created_at",
  CASE
    WHEN invocation."billing_status" IN ('settled', 'released')
      THEN COALESCE(invocation."settled_at", invocation."completed_at", invocation."updated_at")
    ELSE NULL
  END
FROM "ai_invocations" AS invocation
WHERE invocation."funding" = 'managed'
  AND invocation."usage_period_id" IS NOT NULL
  AND invocation."rate_card_id" IS NOT NULL
  AND invocation."billing_status" IN ('reserved', 'settled', 'released')
ON CONFLICT ("workspace_id", "invocation_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "official_cost_entries"
  (
    "workspace_id", "invocation_id", "rate_card_id",
    "official_price_identity", "currency", "source_amount_micros",
    "fx_rate_version", "cny_micros", "measurement_quality",
    "usage", "created_at"
  )
SELECT
  invocation."workspace_id",
  invocation."id",
  invocation."rate_card_id",
  COALESCE(
    invocation."official_price_identity",
    card."official_price_identity",
    invocation."provider" || '.' || invocation."model"
  ),
  card."price_currency",
  NULL,
  card."fx_rate_version",
  invocation."settled_cny_micros",
  'legacy_unknown',
  invocation."usage",
  COALESCE(invocation."settled_at", invocation."completed_at", invocation."updated_at")
FROM "ai_invocations" AS invocation
JOIN "rate_cards" AS card ON card."id" = invocation."rate_card_id"
WHERE invocation."funding" = 'managed'
  AND invocation."billing_status" = 'settled'
  AND invocation."usage_period_id" IS NOT NULL
  AND invocation."settled_cny_micros" IS NOT NULL
ON CONFLICT ("workspace_id", "invocation_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "entitlement_ledger_entries"
  (
    "workspace_id", "invocation_id", "usage_period_id",
    "service_multiplier_id", "multiplier_numerator",
    "multiplier_denominator", "debit_cny_micros",
    "entry_type", "idempotency_key", "created_at"
  )
SELECT
  invocation."workspace_id",
  invocation."id",
  invocation."usage_period_id",
  invocation."entitlement_rate_card_id",
  1,
  1,
  CASE
    WHEN invocation."billing_status" = 'settled'
      THEN COALESCE(invocation."settled_cny_micros", 0)
    ELSE 0
  END,
  CASE
    WHEN invocation."billing_status" = 'settled' THEN 'debit'
    ELSE 'release'
  END,
  COALESCE(
    invocation."billing_idempotency_key",
    'legacy:' || invocation."id"::text
  ) || ':terminal',
  COALESCE(invocation."settled_at", invocation."completed_at", invocation."updated_at")
FROM "ai_invocations" AS invocation
WHERE invocation."funding" = 'managed'
  AND invocation."billing_status" IN ('settled', 'released')
  AND invocation."usage_period_id" IS NOT NULL
  AND invocation."entitlement_rate_card_id" IS NOT NULL
ON CONFLICT ("workspace_id", "invocation_id") DO NOTHING;
