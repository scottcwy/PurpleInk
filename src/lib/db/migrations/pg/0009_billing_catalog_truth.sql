INSERT INTO "workspace_entitlements" (
  "workspace_id",
  "plan_key",
  "starts_at",
  "expires_at",
  "status",
  "source"
)
SELECT
  "workspaces"."id",
  'free',
  now(),
  now() + interval '30 days',
  'active',
  'migration-backfill'
FROM "workspaces"
LEFT JOIN "workspace_entitlements"
  ON "workspace_entitlements"."workspace_id" = "workspaces"."id"
WHERE "workspace_entitlements"."workspace_id" IS NULL
ON CONFLICT ("workspace_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "usage_periods" (
  "workspace_id",
  "plan_key",
  "status",
  "starts_at",
  "ends_at",
  "limit_cny_micros"
)
SELECT
  "workspace_entitlements"."workspace_id",
  "workspace_entitlements"."plan_key",
  'active',
  GREATEST("workspace_entitlements"."starts_at", now()),
  GREATEST("workspace_entitlements"."starts_at", now()) + interval '30 days',
  CASE "workspace_entitlements"."plan_key"
    WHEN 'free' THEN 10000000
    WHEN 'plus' THEN 50000000
    WHEN 'pro' THEN 200000000
    WHEN 'max' THEN 2000000000
  END
FROM "workspace_entitlements"
WHERE "workspace_entitlements"."status" = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM "usage_periods"
    WHERE "usage_periods"."workspace_id" = "workspace_entitlements"."workspace_id"
      AND "usage_periods"."status" = 'active'
      AND "usage_periods"."starts_at" <= now()
      AND "usage_periods"."ends_at" > now()
  )
ON CONFLICT ("workspace_id", "starts_at") DO NOTHING;
