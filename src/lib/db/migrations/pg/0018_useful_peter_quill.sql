ALTER TABLE "ai_invocations" DROP CONSTRAINT "ai_invocations_capability_check";--> statement-breakpoint
ALTER TABLE "rate_card_units" DROP CONSTRAINT "rate_card_units_kind_check";--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_capability_check" CHECK ("ai_invocations"."capability" is null or "ai_invocations"."capability" in (
        'text', 'vision', 'tts', 'asr', 'workflow'
      ));--> statement-breakpoint
ALTER TABLE "rate_card_units" ADD CONSTRAINT "rate_card_units_kind_check" CHECK ("rate_card_units"."unit_kind" in (
        'input_token', 'cached_input_token', 'output_token',
        'tts_character', 'audio_second', 'video_second'
      ));--> statement-breakpoint
INSERT INTO "managed_model_catalog"
  ("id", "provider", "model", "capability", "minimum_plan_key")
VALUES
  (
    '10000000-0000-4000-8000-000000000011',
    'purpleink-engine',
    'website-video-v1',
    'workflow',
    'free'
  )
ON CONFLICT ("provider", "model", "capability") DO UPDATE SET
  "minimum_plan_key" = EXCLUDED."minimum_plan_key",
  "enabled" = true,
  "updated_at" = now();--> statement-breakpoint
INSERT INTO "rate_cards"
  (
    "id",
    "catalog_id",
    "version",
    "price_currency",
    "fx_cny_micros_per_currency_unit",
    "effective_at"
  )
SELECT
  '20000000-0000-4000-8000-000000000011',
  "managed_model_catalog"."id",
  1,
  'CNY',
  1000000,
  '2026-07-30T00:00:00Z'
FROM "managed_model_catalog"
WHERE "provider" = 'purpleink-engine'
  AND "model" = 'website-video-v1'
  AND "capability" = 'workflow'
ON CONFLICT ("catalog_id", "version") DO NOTHING;--> statement-breakpoint
INSERT INTO "rate_card_units"
  (
    "rate_card_id",
    "unit_kind",
    "unit_size",
    "source_price_micros",
    "unit_price_cny_micros"
  )
SELECT
  "rate_cards"."id",
  'video_second',
  1,
  120000,
  120000
FROM "rate_cards"
INNER JOIN "managed_model_catalog"
  ON "managed_model_catalog"."id" = "rate_cards"."catalog_id"
WHERE "managed_model_catalog"."provider" = 'purpleink-engine'
  AND "managed_model_catalog"."model" = 'website-video-v1'
  AND "managed_model_catalog"."capability" = 'workflow'
  AND "rate_cards"."version" = 1
ON CONFLICT ("rate_card_id", "unit_kind") DO NOTHING;
