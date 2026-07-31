ALTER TABLE "rate_card_units" DROP CONSTRAINT "rate_card_units_kind_check";--> statement-breakpoint
ALTER TABLE "rate_cards" ADD COLUMN "pricing_rules" jsonb;--> statement-breakpoint
ALTER TABLE "rate_card_units" ADD CONSTRAINT "rate_card_units_kind_check" CHECK ("rate_card_units"."unit_kind" in (
        'input_token', 'cached_input_token', 'cache_write_token', 'output_token',
        'tts_character', 'audio_second', 'video_second'
      ));
--> statement-breakpoint
UPDATE "rate_cards"
SET "pricing_rules" = '{
  "tiers": [{
    "inputTokensAbove": 272000,
    "inputNumerator": "2",
    "inputDenominator": "1",
    "outputNumerator": "3",
    "outputDenominator": "2"
  }]
}'::jsonb
WHERE "official_price_identity" = 'openai.gpt-5.6-luna';
--> statement-breakpoint
INSERT INTO "rate_card_units"
  ("rate_card_id", "unit_kind", "unit_size", "source_price_micros", "unit_price_cny_micros")
VALUES
  ('20000000-0000-4000-8000-000000000015', 'cache_write_token', 1000000, 1250000, 9000000),
  ('20000000-0000-4000-8000-000000000016', 'cache_write_token', 1000000, 1250000, 9000000)
ON CONFLICT ("rate_card_id", "unit_kind") DO NOTHING;
