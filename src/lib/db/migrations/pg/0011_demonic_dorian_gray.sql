CREATE TABLE "provider_dispatch_cooldowns" (
	"scope_key" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_dispatch_cooldowns_scope_key_check" CHECK (length("provider_dispatch_cooldowns"."scope_key") = 64)
);
