CREATE TABLE "api_access_counters" (
	"bucket_started_at" timestamp with time zone NOT NULL,
	"route_group" text NOT NULL,
	"outcome" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_access_counters_pkey" PRIMARY KEY("bucket_started_at","route_group","outcome"),
	CONSTRAINT "api_access_counters_outcome_check" CHECK ("api_access_counters"."outcome" in ('2xx', '4xx', '401', '404', '5xx')),
	CONSTRAINT "api_access_counters_count_check" CHECK ("api_access_counters"."count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "api_access_counters_bucket_idx" ON "api_access_counters" USING btree ("bucket_started_at" DESC NULLS LAST);