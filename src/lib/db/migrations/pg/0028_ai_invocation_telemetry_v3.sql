ALTER TABLE "ai_invocations" DROP CONSTRAINT "ai_invocations_telemetry_version_check";--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_telemetry_version_check" CHECK ("ai_invocations"."telemetry_version" in (1, 2, 3));--> statement-breakpoint
ALTER TABLE "ai_invocations" ADD CONSTRAINT "ai_invocations_v3_identity_check" CHECK (
  "ai_invocations"."telemetry_version" <> 3 OR (
    nullif(btrim("ai_invocations"."logical_model_id"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."outbound_model_id"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."deployment_id"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."channel_id"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."adapter_protocol"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."official_price_identity"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."provider_pool_id"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."failure_domain_id"), '') IS NOT NULL
    AND nullif(btrim("ai_invocations"."plan_version"), '') IS NOT NULL
  )
);
