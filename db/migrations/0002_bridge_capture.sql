CREATE TABLE "bridge_pairing_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "bridge_pairing_codes_hash_unique" UNIQUE ("code_hash"),
  CONSTRAINT "bridge_pairing_codes_hash_check" CHECK ("code_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "bridge_pairing_codes_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "bridge_pairing_codes_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE INDEX "bridge_pairing_codes_workspace_expiry_idx" ON "bridge_pairing_codes" ("workspace_id", "expires_at");

CREATE TABLE "capture_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "public_key" text NOT NULL,
  "credential_hash" text NOT NULL,
  "label" text NOT NULL,
  "bridge_version" text NOT NULL,
  "ego_version" text NOT NULL,
  "revoked_at" timestamptz,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "capture_devices_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "capture_devices_credential_hash_check" CHECK ("credential_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "capture_devices_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT,
  CONSTRAINT "capture_devices_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE TABLE "capture_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "product_id" uuid NOT NULL,
  "release_id" uuid,
  "device_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "state" text DEFAULT 'created' NOT NULL,
  "connectivity" text DEFAULT 'disconnected' NOT NULL,
  "attempt" integer NOT NULL,
  "run_id" uuid NOT NULL,
  "flow_version_id" uuid NOT NULL,
  "allowed_origins" jsonb NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "hard_expires_at" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  "last_heartbeat_at" timestamptz,
  "current_node_id" text,
  "current_action_id" text,
  "last_event_seq" integer DEFAULT 0 NOT NULL,
  "manifest_hash" text,
  "error_code" text,
  "diagnostic" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "capture_sessions_workspace_id_id_unique" UNIQUE ("workspace_id", "id"),
  CONSTRAINT "capture_sessions_attempt_check" CHECK ("attempt" > 0),
  CONSTRAINT "capture_sessions_event_seq_check" CHECK ("last_event_seq" >= 0),
  CONSTRAINT "capture_sessions_kind_check" CHECK ("kind" IN ('discovery', 'capture')),
  CONSTRAINT "capture_sessions_state_check" CHECK ("state" IN ('created', 'claimed', 'running', 'uploading', 'awaiting_user', 'completed', 'failed', 'cancelled', 'expired')),
  CONSTRAINT "capture_sessions_connectivity_check" CHECK ("connectivity" IN ('connected', 'disconnected')),
  CONSTRAINT "capture_sessions_expiry_check" CHECK ("expires_at" <= "hard_expires_at"),
  CONSTRAINT "capture_sessions_manifest_hash_check" CHECK ("manifest_hash" IS NULL OR "manifest_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "capture_sessions_workspace_product_fk" FOREIGN KEY ("workspace_id", "product_id") REFERENCES "products"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "capture_sessions_workspace_release_fk" FOREIGN KEY ("workspace_id", "release_id") REFERENCES "releases"("workspace_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "capture_sessions_workspace_device_fk" FOREIGN KEY ("workspace_id", "device_id") REFERENCES "capture_devices"("workspace_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "capture_sessions_device_state_idx" ON "capture_sessions" ("device_id", "state");
CREATE UNIQUE INDEX "capture_sessions_active_release_kind_unique"
  ON "capture_sessions" ("workspace_id", "product_id", COALESCE("release_id", '00000000-0000-0000-0000-000000000000'::uuid), "kind")
  WHERE "state" NOT IN ('completed', 'failed', 'cancelled', 'expired');

CREATE TABLE "capture_session_events" (
  "workspace_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "capture_session_events_session_seq_pk" PRIMARY KEY ("session_id", "seq"),
  CONSTRAINT "capture_session_events_seq_check" CHECK ("seq" > 0),
  CONSTRAINT "capture_session_events_workspace_session_fk" FOREIGN KEY ("workspace_id", "session_id") REFERENCES "capture_sessions"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "capture_upload_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "attempt" integer NOT NULL,
  "r2_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "bytes" integer NOT NULL,
  "sha256" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "capture_upload_intents_session_key_unique" UNIQUE ("session_id", "r2_key"),
  CONSTRAINT "capture_upload_intents_bytes_check" CHECK ("bytes" > 0),
  CONSTRAINT "capture_upload_intents_hash_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "capture_upload_intents_workspace_session_fk" FOREIGN KEY ("workspace_id", "session_id") REFERENCES "capture_sessions"("workspace_id", "id") ON DELETE RESTRICT
);

CREATE TABLE "evidence_manifests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "attempt" integer NOT NULL,
  "schema_version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "content_hash" text NOT NULL,
  "verified_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "evidence_manifests_session_attempt_unique" UNIQUE ("session_id", "attempt"),
  CONSTRAINT "evidence_manifests_schema_check" CHECK ("schema_version" = 'evidence-manifest/v1'),
  CONSTRAINT "evidence_manifests_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "evidence_manifests_workspace_session_fk" FOREIGN KEY ("workspace_id", "session_id") REFERENCES "capture_sessions"("workspace_id", "id") ON DELETE RESTRICT
);
