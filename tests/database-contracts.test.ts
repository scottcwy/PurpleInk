import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

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
        "bridge_pairing_codes",
        "capture_devices",
        "capture_sessions",
        "capture_session_events",
        "capture_upload_intents",
        "evidence_manifests",
        "discovery_runs",
        "capture_runs",
        "node_executions",
        "source_assets",
        "asset_versions",
        "node_evidence",
        "composition_bundles",
        "render_jobs",
        "render_attempts",
        "artifacts",
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

  it("deduplicates capture events by session and seq", async () => {
    const deviceId = "70000000-0000-4000-8000-000000000001";
    const sessionId = "71000000-0000-4000-8000-000000000001";
    await database.exec(`
      insert into capture_devices (
        id, workspace_id, user_id, public_key, credential_hash, label,
        bridge_version, ego_version
      ) values (
        '${deviceId}', '${workspaceA}', '${userA}', 'public-key', repeat('c', 64),
        'Test Mac', '0.1.0', '0.4.4.17'
      );
      insert into capture_sessions (
        id, workspace_id, product_id, release_id, device_id, kind, state,
        connectivity, attempt, run_id, flow_version_id, allowed_origins,
        expires_at, hard_expires_at
      ) values (
        '${sessionId}', '${workspaceA}', '${productA}', '${releaseA}', '${deviceId}',
        'capture', 'running', 'connected', 1,
        '72000000-0000-4000-8000-000000000001',
        '73000000-0000-4000-8000-000000000001',
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
