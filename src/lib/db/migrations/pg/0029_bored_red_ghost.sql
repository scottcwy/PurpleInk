CREATE TABLE "api_access_counters" (
	"route_group" text NOT NULL,
	"outcome" text NOT NULL,
	"bucket_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "api_access_counters_pkey" PRIMARY KEY("bucket_started_at","route_group","outcome"),
	CONSTRAINT "api_access_counters_route_group_check" CHECK (length("api_access_counters"."route_group") between 1 and 80),
	CONSTRAINT "api_access_counters_outcome_check" CHECK ("api_access_counters"."outcome" in ('2xx', '4xx', '5xx', '401', '404')),
	CONSTRAINT "api_access_counters_count_check" CHECK ("api_access_counters"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('user', 'admin'));
