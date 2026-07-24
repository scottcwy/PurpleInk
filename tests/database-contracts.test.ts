import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, it } from "vitest";
import { engineeringSchema } from "@/db/schema";

const migrationsUrl = new URL("../db/migrations/", import.meta.url);

const workspaceA = "00000000-0000-4000-8000-000000000001";
const workspaceB = "00000000-0000-4000-8000-000000000002";
const userA = "10000000-0000-4000-8000-000000000001";
const productA = "20000000-0000-4000-8000-000000000001";
const releaseA = "30000000-0000-4000-8000-000000000001";
const brandKitA = "40000000-0000-4000-8000-000000000001";

let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  const migrationFiles = (await readdir(migrationsUrl))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migrationFile of migrationFiles) {
    await database.exec(
      await readFile(new URL(migrationFile, migrationsUrl), "utf8")
    );
  }
  await database.exec(`
    insert into workspaces (id, name, slug) values
      ('${workspaceA}', 'Workspace A', 'workspace-a'),
      ('${workspaceB}', 'Workspace B', 'workspace-b');
    insert into users (id, email, name)
      values ('${userA}', 'owner@example.com', 'Owner');
    insert into memberships (workspace_id, user_id, role)
      values ('${workspaceA}', '${userA}', 'owner');
    insert into products (id, workspace_id, name, canonical_url)
      values ('${productA}', '${workspaceA}', 'Product A', 'https://product.example.com');
    insert into releases (id, workspace_id, product_id, name)
      values ('${releaseA}', '${workspaceA}', '${productA}', 'July launch');
    insert into brand_kits (id, workspace_id, product_id)
      values ('${brandKitA}', '${workspaceA}', '${productA}');
  `);
});

describe("database constraints", () => {
  it("exports only the Accepted v3 capture and evidence schema", () => {
    expect(Object.keys(engineeringSchema)).toEqual(
      expect.arrayContaining([
        "browserProfiles",
        "productCapabilities",
        "captureWorkerJobs",
        "evidencePackages",
        "evidencePackageVersions",
        "commandReceipts",
      ])
    );
    expect(Object.keys(engineeringSchema)).not.toEqual(
      expect.arrayContaining(["bridgePairingCodes", "captureDevices"])
    );
  });

  it("declares workspace-scoped primary keys in the canonical Drizzle schema", () => {
    for (const table of Object.values(engineeringSchema)) {
      const config = getTableConfig(table as PgTable);
      if (!config.columns.some((column) => column.name === "workspace_id")) continue;
      const primaryColumns = config.primaryKeys.flatMap((key) => key.columns.map((column) => column.name));
      expect(primaryColumns, config.name).toContain("workspace_id");
    }
  });

  it("creates the engineering foundation tables", async () => {
    const result = await database.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `);

    expect(result.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([
        "workspaces",
        "users",
        "memberships",
        "products",
        "product_capabilities",
        "releases",
        "brand_kits",
        "brand_kit_versions",
        "product_flows",
        "product_flow_versions",
        "release_brief_versions",
        "approvals",
        "storyboards",
        "storyboard_versions",
        "audit_events",
        "browser_profiles",
        "capture_sessions",
        "capture_worker_jobs",
        "capture_handoffs",
        "capture_session_events",
        "capture_upload_intents",
        "evidence_manifests",
        "discovery_runs",
        "capture_runs",
        "node_executions",
        "source_assets",
        "asset_versions",
        "node_evidence",
        "evidence_packages",
        "evidence_package_versions",
        "command_receipts",
        "launch_video_jobs",
        "launch_video_plans",
        "render_job_receipts",
        "release_invalidations",
        "composition_bundles",
        "render_jobs",
        "render_attempts",
        "artifacts",
      ])
    );
    expect(result.rows.map(({ table_name }) => table_name)).not.toEqual(
      expect.arrayContaining(["bridge_pairing_codes", "capture_devices"])
    );
  });

  it("persists clean replay provenance on DiscoveryRun", async () => {
    const result = await database.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema='public' and table_name='discovery_runs'
    `);
    expect(result.rows.map(({ column_name }) => column_name)).toEqual(
      expect.arrayContaining([
        "clean_replay_manifest_hash",
        "clean_replay_worker_image_digest",
        "clean_replay_passed_at",
      ])
    );
  });

  it("rejects cross-workspace capture run ownership", async () => {
    await expect(
      database.exec(`
        insert into capture_runs (
          workspace_id, release_id, flow_version_id, capture_session_id, status
        ) values (
          '${workspaceB}', '${releaseA}',
          '73000000-0000-4000-8000-000000000001',
          '71000000-0000-4000-8000-000000000001', 'pending'
        )
      `)
    ).rejects.toThrow();
  });

  it("allows the same business ID in two workspaces without cross-reading", async () => {
    const sharedId = "21000000-0000-4000-8000-000000000001";
    await database.exec(`
      insert into products (id, workspace_id, name, canonical_url) values
        ('${sharedId}', '${workspaceA}', 'Scoped A', 'https://a.example.com'),
        ('${sharedId}', '${workspaceB}', 'Scoped B', 'https://b.example.com');
    `);
    const result = await database.query<{ name: string }>(`
      select name from products
      where workspace_id = '${workspaceA}' and id = '${sharedId}'
    `);
    expect(result.rows).toEqual([{ name: "Scoped A" }]);
  });

  it("deduplicates capture events by session and seq", async () => {
    const profileId = "70000000-0000-4000-8000-000000000001";
    const sessionId = "71000000-0000-4000-8000-000000000001";
    await database.exec(`
      insert into browser_profiles (
        id, workspace_id, product_id, encrypted_state_ref, status, revision
      ) values (
        '${profileId}', '${workspaceA}', '${productA}', 'kms://test/profile',
        'active', 1
      );
      insert into capture_sessions (
        id, workspace_id, product_id, release_id, browser_profile_id, kind, state,
        connectivity, allowed_origins,
        expires_at, hard_expires_at
      ) values (
        '${sessionId}', '${workspaceA}', '${productA}', '${releaseA}', '${profileId}',
        'capture', 'running', 'connected',
        '["https://product.example.com"]', now() + interval '30 minutes',
        now() + interval '60 minutes'
      );
      insert into capture_session_events (
        workspace_id, session_id, seq, event_type, payload
      ) values ('${workspaceA}', '${sessionId}', 1, 'action_completed', '{}');
    `);
    await expect(
      database.exec(`
        insert into capture_session_events (
          workspace_id, session_id, seq, event_type, payload
        ) values ('${workspaceA}', '${sessionId}', 1, 'different', '{}')
      `)
    ).rejects.toThrow();
  });

  it("requires every release invalidation to reference a workspace-owned command receipt", async () => {
    await expect(database.exec(`
      insert into release_invalidations(
        workspace_id,release_id,command_receipt_id,changed_ref,
        replacement_version_id,stale_object_type,stale_object_id
      ) values(
        '${workspaceA}','${releaseA}','99000000-0000-4000-8000-000000000099',
        'storyboard_version','99000000-0000-4000-8000-000000000001',
        'composition_bundle','99000000-0000-4000-8000-000000000002'
      )
    `)).rejects.toThrow();
  });

  it("requires HTTPS product URLs", async () => {
    await expect(
      database.exec(`
        insert into products (workspace_id, name, canonical_url)
        values ('${workspaceA}', 'Unsafe product', 'http://product.example.com')
      `)
    ).rejects.toThrow();
  });

  it("rejects a release that links to another workspace product", async () => {
    await expect(
      database.exec(`
        insert into releases (workspace_id, product_id, name)
        values ('${workspaceB}', '${productA}', 'Cross-tenant release')
      `)
    ).rejects.toThrow();
  });

  it("rejects a version that links to another workspace aggregate", async () => {
    await expect(
      database.exec(`
        insert into brand_kit_versions (
          workspace_id, brand_kit_id, version, schema_version, payload, content_hash
        ) values (
          '${workspaceB}', '${brandKitA}', 1, 'brand-kit/v1', '{}', repeat('a', 64)
        )
      `)
    ).rejects.toThrow();
  });

  it("keeps approved versions immutable", async () => {
    const versionId = "41000000-0000-4000-8000-000000000001";
    await database.exec(`
      insert into brand_kit_versions (
        id, workspace_id, brand_kit_id, version, schema_version, payload,
        content_hash, status, approved_at
      ) values (
        '${versionId}', '${workspaceA}', '${brandKitA}', 1, 'brand-kit/v1',
        '{}', repeat('b', 64), 'approved', now()
      )
    `);

    await expect(
      database.exec(`
        update brand_kit_versions set payload = '{"changed":true}'
        where id = '${versionId}'
      `)
    ).rejects.toThrow(/immutable/);
    await expect(
      database.exec(`delete from brand_kit_versions where id = '${versionId}'`)
    ).rejects.toThrow(/immutable/);
  });

  it("keeps audit events append-only", async () => {
    const eventId = "50000000-0000-4000-8000-000000000001";
    await database.exec(`
      insert into audit_events (
        id, workspace_id, actor_type, actor_id, event_type, subject_type,
        subject_id, payload
      ) values (
        '${eventId}', '${workspaceA}', 'user', '${userA}', 'product.created',
        'product', '${productA}', '{}'
      )
    `);

    await expect(
      database.exec(`delete from audit_events where id = '${eventId}'`)
    ).rejects.toThrow(/append-only/);
  });

  it("keeps approval decisions append-only", async () => {
    const approvalId = "60000000-0000-4000-8000-000000000001";
    const subjectId = "61000000-0000-4000-8000-000000000001";
    await database.exec(`
      insert into approvals (
        id, workspace_id, release_id, subject_type, subject_id, decision, actor_id
      ) values (
        '${approvalId}', '${workspaceA}', '${releaseA}', 'release_brief_version',
        '${subjectId}', 'approved', '${userA}'
      )
    `);

    await expect(
      database.exec(
        `update approvals set decision = 'rejected' where id = '${approvalId}'`
      )
    ).rejects.toThrow(/append-only/);
    await expect(
      database.exec(`delete from approvals where id = '${approvalId}'`)
    ).rejects.toThrow(/append-only/);
  });
});
