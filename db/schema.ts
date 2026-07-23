import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)]
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index("memberships_user_id_idx").on(table.userId),
    check(
      "memberships_role_check",
      sql`${table.role} in ('owner', 'admin', 'member', 'viewer')`
    ),
  ]
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    status: text("status").notNull().default("active"),
    revision: integer("revision").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("products_workspace_id_id_unique").on(table.workspaceId, table.id),
    index("products_workspace_id_idx").on(table.workspaceId),
    check(
      "products_canonical_url_https_check",
      sql`${table.canonicalUrl} like 'https://%'`
    ),
    check(
      "products_status_check",
      sql`${table.status} in ('active', 'archived')`
    ),
    check("products_revision_check", sql`${table.revision} > 0`),
  ]
);

export const brandKits = pgTable(
  "brand_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    productId: uuid("product_id").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("brand_kits_workspace_id_id_unique").on(table.workspaceId, table.id),
    unique("brand_kits_workspace_product_unique").on(
      table.workspaceId,
      table.productId
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "brand_kits_workspace_product_fk",
    }).onDelete("restrict"),
  ]
);

export const productFlows = pgTable(
  "product_flows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("product_flows_workspace_id_id_unique").on(
      table.workspaceId,
      table.id
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "product_flows_workspace_product_fk",
    }).onDelete("restrict"),
    check("product_flows_revision_check", sql`${table.revision} > 0`),
  ]
);

const releaseStages = sql`(
  'brief_draft', 'flow_selecting', 'flow_discovering', 'flow_review',
  'capture_pending', 'capturing', 'evidence_review',
  'storyboard_generating', 'storyboard_review', 'preview_queued',
  'preview_rendering', 'preview_review', 'final_queued', 'final_rendering',
  'complete'
)`;

export const releases = pgTable(
  "releases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    productId: uuid("product_id").notNull(),
    name: text("name").notNull(),
    lifecycle: text("lifecycle").notNull().default("active"),
    stage: text("stage").notNull().default("brief_draft"),
    failedFromStage: text("failed_from_stage"),
    revision: integer("revision").notNull().default(1),
    briefVersionId: uuid("brief_version_id"),
    productFlowVersionId: uuid("product_flow_version_id"),
    captureRunId: uuid("capture_run_id"),
    storyboardVersionId: uuid("storyboard_version_id"),
    previewBundleId: uuid("preview_bundle_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("releases_workspace_id_id_unique").on(table.workspaceId, table.id),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "releases_workspace_product_fk",
    }).onDelete("restrict"),
    index("releases_workspace_id_idx").on(table.workspaceId),
    index("releases_workspace_product_idx").on(
      table.workspaceId,
      table.productId
    ),
    check(
      "releases_lifecycle_check",
      sql`${table.lifecycle} in ('active', 'failed', 'cancelled', 'delivered')`
    ),
    check("releases_stage_check", sql`${table.stage} in ${releaseStages}`),
    check(
      "releases_failed_from_stage_check",
      sql`${table.failedFromStage} is null or ${table.failedFromStage} in ${releaseStages}`
    ),
    check(
      "releases_failed_lifecycle_check",
      sql`(${table.lifecycle} = 'failed') = (${table.failedFromStage} is not null)`
    ),
    check("releases_revision_check", sql`${table.revision} > 0`),
  ]
);

export const storyboards = pgTable(
  "storyboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("storyboards_workspace_id_id_unique").on(
      table.workspaceId,
      table.id
    ),
    unique("storyboards_workspace_release_unique").on(
      table.workspaceId,
      table.releaseId
    ),
    foreignKey({
      columns: [table.workspaceId, table.releaseId],
      foreignColumns: [releases.workspaceId, releases.id],
      name: "storyboards_workspace_release_fk",
    }).onDelete("restrict"),
  ]
);

export const brandKitVersions = pgTable(
  "brand_kit_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    brandKitId: uuid("brand_kit_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("brand_kit_versions_aggregate_version_unique").on(
      table.brandKitId,
      table.version
    ),
    foreignKey({
      columns: [table.workspaceId, table.brandKitId],
      foreignColumns: [brandKits.workspaceId, brandKits.id],
      name: "brand_kit_versions_workspace_aggregate_fk",
    }).onDelete("restrict"),
    check("brand_kit_versions_version_check", sql`${table.version} > 0`),
    check(
      "brand_kit_versions_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "brand_kit_versions_status_check",
      sql`${table.status} in ('draft', 'approved', 'rejected')`
    ),
    check(
      "brand_kit_versions_approval_check",
      sql`(${table.status} = 'approved') = (${table.approvedAt} is not null)`
    ),
  ]
);

export const productFlowVersions = pgTable(
  "product_flow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    productFlowId: uuid("product_flow_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("product_flow_versions_workspace_id_id_unique").on(table.workspaceId, table.id),
    unique("product_flow_versions_aggregate_version_unique").on(
      table.productFlowId,
      table.version
    ),
    foreignKey({
      columns: [table.workspaceId, table.productFlowId],
      foreignColumns: [productFlows.workspaceId, productFlows.id],
      name: "product_flow_versions_workspace_aggregate_fk",
    }).onDelete("restrict"),
    check("product_flow_versions_version_check", sql`${table.version} > 0`),
    check(
      "product_flow_versions_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "product_flow_versions_status_check",
      sql`${table.status} in ('draft', 'approved', 'rejected')`
    ),
    check(
      "product_flow_versions_approval_check",
      sql`(${table.status} = 'approved') = (${table.approvedAt} is not null)`
    ),
  ]
);

export const releaseBriefVersions = pgTable(
  "release_brief_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("release_brief_versions_aggregate_version_unique").on(
      table.releaseId,
      table.version
    ),
    foreignKey({
      columns: [table.workspaceId, table.releaseId],
      foreignColumns: [releases.workspaceId, releases.id],
      name: "release_brief_versions_workspace_aggregate_fk",
    }).onDelete("restrict"),
    check("release_brief_versions_version_check", sql`${table.version} > 0`),
    check(
      "release_brief_versions_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "release_brief_versions_status_check",
      sql`${table.status} in ('draft', 'approved', 'rejected')`
    ),
    check(
      "release_brief_versions_approval_check",
      sql`(${table.status} = 'approved') = (${table.approvedAt} is not null)`
    ),
  ]
);

export const storyboardVersions = pgTable(
  "storyboard_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    storyboardId: uuid("storyboard_id").notNull(),
    version: integer("version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    status: text("status").notNull().default("draft"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    unique("storyboard_versions_workspace_id_id_unique").on(table.workspaceId, table.id),
    unique("storyboard_versions_aggregate_version_unique").on(
      table.storyboardId,
      table.version
    ),
    foreignKey({
      columns: [table.workspaceId, table.storyboardId],
      foreignColumns: [storyboards.workspaceId, storyboards.id],
      name: "storyboard_versions_workspace_aggregate_fk",
    }).onDelete("restrict"),
    check("storyboard_versions_version_check", sql`${table.version} > 0`),
    check(
      "storyboard_versions_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "storyboard_versions_status_check",
      sql`${table.status} in ('draft', 'approved', 'rejected')`
    ),
    check(
      "storyboard_versions_approval_check",
      sql`(${table.status} = 'approved') = (${table.approvedAt} is not null)`
    ),
  ]
);

export const bridgePairingCodes = pgTable(
  "bridge_pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("bridge_pairing_codes_hash_unique").on(table.codeHash),
    index("bridge_pairing_codes_workspace_expiry_idx").on(
      table.workspaceId,
      table.expiresAt
    ),
    check(
      "bridge_pairing_codes_hash_check",
      sql`${table.codeHash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

export const captureDevices = pgTable(
  "capture_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publicKey: text("public_key").notNull(),
    credentialHash: text("credential_hash").notNull(),
    label: text("label").notNull(),
    bridgeVersion: text("bridge_version").notNull(),
    egoVersion: text("ego_version").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt,
  },
  (table) => [
    unique("capture_devices_workspace_id_id_unique").on(
      table.workspaceId,
      table.id
    ),
    foreignKey({
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
      name: "capture_devices_workspace_fk",
    }).onDelete("restrict"),
    check(
      "capture_devices_credential_hash_check",
      sql`${table.credentialHash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

export const captureSessions = pgTable(
  "capture_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    productId: uuid("product_id").notNull(),
    releaseId: uuid("release_id"),
    deviceId: uuid("device_id").notNull(),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("created"),
    connectivity: text("connectivity").notNull().default("disconnected"),
    attempt: integer("attempt").notNull(),
    runId: uuid("run_id").notNull(),
    flowVersionId: uuid("flow_version_id").notNull(),
    allowedOrigins: jsonb("allowed_origins").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    hardExpiresAt: timestamp("hard_expires_at", { withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    currentNodeId: text("current_node_id"),
    currentActionId: text("current_action_id"),
    lastEventSeq: integer("last_event_seq").notNull().default(0),
    manifestHash: text("manifest_hash"),
    errorCode: text("error_code"),
    diagnostic: text("diagnostic"),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("capture_sessions_workspace_id_id_unique").on(
      table.workspaceId,
      table.id
    ),
    foreignKey({
      columns: [table.workspaceId, table.productId],
      foreignColumns: [products.workspaceId, products.id],
      name: "capture_sessions_workspace_product_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.releaseId],
      foreignColumns: [releases.workspaceId, releases.id],
      name: "capture_sessions_workspace_release_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.workspaceId, table.deviceId],
      foreignColumns: [captureDevices.workspaceId, captureDevices.id],
      name: "capture_sessions_workspace_device_fk",
    }).onDelete("restrict"),
    index("capture_sessions_device_state_idx").on(table.deviceId, table.state),
    check("capture_sessions_attempt_check", sql`${table.attempt} > 0`),
    check("capture_sessions_event_seq_check", sql`${table.lastEventSeq} >= 0`),
    check(
      "capture_sessions_kind_check",
      sql`${table.kind} in ('discovery', 'capture')`
    ),
    check(
      "capture_sessions_state_check",
      sql`${table.state} in ('created', 'claimed', 'running', 'uploading', 'awaiting_user', 'completed', 'failed', 'cancelled', 'expired')`
    ),
    check(
      "capture_sessions_connectivity_check",
      sql`${table.connectivity} in ('connected', 'disconnected')`
    ),
    check(
      "capture_sessions_expiry_check",
      sql`${table.expiresAt} <= ${table.hardExpiresAt}`
    ),
  ]
);

export const captureSessionEvents = pgTable(
  "capture_session_events",
  {
    workspaceId: uuid("workspace_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.seq] }),
    foreignKey({
      columns: [table.workspaceId, table.sessionId],
      foreignColumns: [captureSessions.workspaceId, captureSessions.id],
      name: "capture_session_events_workspace_session_fk",
    }).onDelete("restrict"),
    check("capture_session_events_seq_check", sql`${table.seq} > 0`),
  ]
);

export const captureUploadIntents = pgTable(
  "capture_upload_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    attempt: integer("attempt").notNull(),
    r2Key: text("r2_key").notNull(),
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    unique("capture_upload_intents_session_key_unique").on(
      table.sessionId,
      table.r2Key
    ),
    foreignKey({
      columns: [table.workspaceId, table.sessionId],
      foreignColumns: [captureSessions.workspaceId, captureSessions.id],
      name: "capture_upload_intents_workspace_session_fk",
    }).onDelete("restrict"),
    check("capture_upload_intents_bytes_check", sql`${table.bytes} > 0`),
    check(
      "capture_upload_intents_hash_check",
      sql`${table.sha256} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

export const evidenceManifests = pgTable(
  "evidence_manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    attempt: integer("attempt").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    unique("evidence_manifests_session_attempt_unique").on(
      table.sessionId,
      table.attempt
    ),
    foreignKey({
      columns: [table.workspaceId, table.sessionId],
      foreignColumns: [captureSessions.workspaceId, captureSessions.id],
      name: "evidence_manifests_workspace_session_fk",
    }).onDelete("restrict"),
    check(
      "evidence_manifests_schema_check",
      sql`${table.schemaVersion} = 'evidence-manifest/v1'`
    ),
    check(
      "evidence_manifests_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

export const discoveryRuns = pgTable("discovery_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  productFlowId: uuid("product_flow_id").notNull(),
  captureSessionId: uuid("capture_session_id").notNull(),
  status: text("status").notNull().default("pending"),
  proposedVersionId: uuid("proposed_version_id"),
  createdAt,
  updatedAt,
}, (table) => [
  unique("discovery_runs_workspace_id_id_unique").on(table.workspaceId, table.id),
  foreignKey({ columns: [table.workspaceId, table.productFlowId], foreignColumns: [productFlows.workspaceId, productFlows.id], name: "discovery_runs_workspace_flow_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.captureSessionId], foreignColumns: [captureSessions.workspaceId, captureSessions.id], name: "discovery_runs_workspace_session_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.proposedVersionId], foreignColumns: [productFlowVersions.workspaceId, productFlowVersions.id], name: "discovery_runs_workspace_version_fk" }).onDelete("restrict"),
  check("discovery_runs_status_check", sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled')`),
]);

export const captureRuns = pgTable("capture_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  releaseId: uuid("release_id").notNull(),
  flowVersionId: uuid("flow_version_id").notNull(),
  captureSessionId: uuid("capture_session_id").notNull(),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt,
}, (table) => [
  unique("capture_runs_workspace_id_id_unique").on(table.workspaceId, table.id),
  foreignKey({ columns: [table.workspaceId, table.releaseId], foreignColumns: [releases.workspaceId, releases.id], name: "capture_runs_workspace_release_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.flowVersionId], foreignColumns: [productFlowVersions.workspaceId, productFlowVersions.id], name: "capture_runs_workspace_flow_version_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.captureSessionId], foreignColumns: [captureSessions.workspaceId, captureSessions.id], name: "capture_runs_workspace_session_fk" }).onDelete("restrict"),
  check("capture_runs_status_check", sql`${table.status} in ('pending', 'running', 'completed', 'failed', 'cancelled')`),
]);

export const nodeExecutions = pgTable("node_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  captureRunId: uuid("capture_run_id").notNull(),
  nodeId: text("node_id").notNull(),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  errorCode: text("error_code"),
  createdAt,
}, (table) => [
  unique("node_executions_workspace_id_id_unique").on(table.workspaceId, table.id),
  unique("node_executions_run_node_unique").on(table.captureRunId, table.nodeId),
  foreignKey({ columns: [table.workspaceId, table.captureRunId], foreignColumns: [captureRuns.workspaceId, captureRuns.id], name: "node_executions_workspace_run_fk" }).onDelete("restrict"),
  check("node_executions_status_check", sql`${table.status} in ('pending', 'running', 'passed', 'failed')`),
]);

export const sourceAssets = pgTable("source_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  productId: uuid("product_id").notNull(),
  kind: text("kind").notNull(),
  createdAt,
}, (table) => [
  unique("source_assets_workspace_id_id_unique").on(table.workspaceId, table.id),
  foreignKey({ columns: [table.workspaceId, table.productId], foreignColumns: [products.workspaceId, products.id], name: "source_assets_workspace_product_fk" }).onDelete("restrict"),
]);

export const assetVersions = pgTable("asset_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  sourceAssetId: uuid("source_asset_id").notNull(),
  r2Key: text("r2_key").notNull(),
  sha256: text("sha256").notNull(),
  bytes: integer("bytes").notNull(),
  mimeType: text("mime_type").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt,
}, (table) => [
  unique("asset_versions_workspace_id_id_unique").on(table.workspaceId, table.id),
  unique("asset_versions_source_hash_unique").on(table.sourceAssetId, table.sha256),
  foreignKey({ columns: [table.workspaceId, table.sourceAssetId], foreignColumns: [sourceAssets.workspaceId, sourceAssets.id], name: "asset_versions_workspace_source_fk" }).onDelete("restrict"),
  check("asset_versions_hash_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("asset_versions_bytes_check", sql`${table.bytes} > 0`),
]);

export const nodeEvidence = pgTable("node_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  nodeExecutionId: uuid("node_execution_id").notNull(),
  kind: text("kind").notNull(),
  assetVersionId: uuid("asset_version_id").notNull(),
  manifest: jsonb("manifest").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt,
}, (table) => [
  unique("node_evidence_workspace_id_id_unique").on(table.workspaceId, table.id),
  foreignKey({ columns: [table.workspaceId, table.nodeExecutionId], foreignColumns: [nodeExecutions.workspaceId, nodeExecutions.id], name: "node_evidence_workspace_execution_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.assetVersionId], foreignColumns: [assetVersions.workspaceId, assetVersions.id], name: "node_evidence_workspace_asset_fk" }).onDelete("restrict"),
]);

export const compositionBundles = pgTable("composition_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  releaseId: uuid("release_id").notNull(),
  storyboardVersionId: uuid("storyboard_version_id").notNull(),
  planHash: text("plan_hash").notNull(),
  bundleHash: text("bundle_hash").notNull(),
  r2Key: text("r2_key").notNull(),
  status: text("status").notNull().default("created"),
  createdAt,
}, (table) => [
  unique("composition_bundles_workspace_id_id_unique").on(table.workspaceId, table.id),
  unique("composition_bundles_release_plan_unique").on(table.releaseId, table.planHash),
  foreignKey({ columns: [table.workspaceId, table.releaseId], foreignColumns: [releases.workspaceId, releases.id], name: "composition_bundles_workspace_release_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.storyboardVersionId], foreignColumns: [storyboardVersions.workspaceId, storyboardVersions.id], name: "composition_bundles_workspace_storyboard_fk" }).onDelete("restrict"),
  check("composition_bundles_hashes_check", sql`${table.planHash} ~ '^[0-9a-f]{64}$' and ${table.bundleHash} ~ '^[0-9a-f]{64}$'`),
]);

export const renderJobs = pgTable("render_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  releaseId: uuid("release_id").notNull(),
  bundleId: uuid("bundle_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  renderKey: text("render_key").notNull(),
  requestedOutputs: jsonb("requested_outputs").notNull(),
  currentAttempt: integer("current_attempt").notNull().default(0),
  createdAt,
  updatedAt,
}, (table) => [
  unique("render_jobs_workspace_id_id_unique").on(table.workspaceId, table.id),
  foreignKey({ columns: [table.workspaceId, table.releaseId], foreignColumns: [releases.workspaceId, releases.id], name: "render_jobs_workspace_release_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.bundleId], foreignColumns: [compositionBundles.workspaceId, compositionBundles.id], name: "render_jobs_workspace_bundle_fk" }).onDelete("restrict"),
  check("render_jobs_attempt_check", sql`${table.currentAttempt} >= 0`),
]);

export const renderAttempts = pgTable("render_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  renderJobId: uuid("render_job_id").notNull(),
  attempt: integer("attempt").notNull(),
  status: text("status").notNull().default("running"),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  unique("render_attempts_workspace_id_id_unique").on(table.workspaceId, table.id),
  unique("render_attempts_job_attempt_unique").on(table.renderJobId, table.attempt),
  foreignKey({ columns: [table.workspaceId, table.renderJobId], foreignColumns: [renderJobs.workspaceId, renderJobs.id], name: "render_attempts_workspace_job_fk" }).onDelete("restrict"),
  check("render_attempts_attempt_check", sql`${table.attempt} > 0`),
]);

export const artifacts = pgTable("artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  renderJobId: uuid("render_job_id").notNull(),
  attemptId: uuid("attempt_id").notNull(),
  kind: text("kind").notNull(),
  r2Key: text("r2_key").notNull(),
  sha256: text("sha256").notNull(),
  metadata: jsonb("metadata").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt,
}, (table) => [
  foreignKey({ columns: [table.workspaceId, table.renderJobId], foreignColumns: [renderJobs.workspaceId, renderJobs.id], name: "artifacts_workspace_job_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.workspaceId, table.attemptId], foreignColumns: [renderAttempts.workspaceId, renderAttempts.id], name: "artifacts_workspace_attempt_fk" }).onDelete("restrict"),
  check("artifacts_hash_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
]);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    decision: text("decision").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt,
  },
  (table) => [
    foreignKey({
      columns: [table.workspaceId, table.releaseId],
      foreignColumns: [releases.workspaceId, releases.id],
      name: "approvals_workspace_release_fk",
    }).onDelete("restrict"),
    index("approvals_release_created_idx").on(
      table.workspaceId,
      table.releaseId,
      table.createdAt
    ),
    check(
      "approvals_decision_check",
      sql`${table.decision} in ('approved', 'rejected')`
    ),
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    eventType: text("event_type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (table) => [
    index("audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
);

export const engineeringSchema = {
  workspaces,
  users,
  memberships,
  products,
  brandKits,
  brandKitVersions,
  productFlows,
  productFlowVersions,
  releases,
  releaseBriefVersions,
  storyboards,
  storyboardVersions,
  bridgePairingCodes,
  captureDevices,
  captureSessions,
  captureSessionEvents,
  captureUploadIntents,
  evidenceManifests,
  discoveryRuns,
  captureRuns,
  nodeExecutions,
  sourceAssets,
  assetVersions,
  nodeEvidence,
  compositionBundles,
  renderJobs,
  renderAttempts,
  artifacts,
  approvals,
  auditEvents,
};
