# Zeabur Predev Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use minipowers:subagent-driven-development (recommended) or minipowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce `zeabur/predev-integration` with `predev` as the business and migration truth, Zeabur Git builds as the only production deployment path, Cloudflare R2 as the durable Artifact and PostgreSQL-backup store, and no GHCR production dependency.

**Architecture:** Web owns PostgreSQL, provider, billing, mail, and R2 credentials. Worker remains private and owns no database, provider, billing, pricing, or R2 credentials; it calls the authenticated Web AI gateway. Zeabur PostgreSQL is the structured-data truth, R2 is the durable byte store, and a separate Backup service uploads verified `pg_dump -Fc` archives to R2.

**Tech Stack:** Next.js 16, TypeScript, pnpm 10.30.0, PostgreSQL 17.5, Drizzle, Vitest, Playwright, Zeabur templates, Cloudflare R2/S3 API, Docker.

## Global Constraints

- Start from `origin/predev@ad5d25684e3d21fb05437fd5c31da280e211b12a`; preserve all Admin, AI ExecutionPlan, billing, workflow recovery, auth, canvas, queue, Artifact, and migration contracts from that tree.
- Production deployment is Zeabur Git build only. Do not publish, pull, tag, or document GHCR images as a production path.
- PostgreSQL 17.5 is the only structured business-data source. R2 does not replace PostgreSQL.
- R2 stores durable Artifact bytes and PostgreSQL backup archives. Local filesystem storage is a working cache/staging layer.
- Worker receives only `PURPLEINK_ENGINE_INTERNAL_KEY`, `PURPLEINK_AI_GATEWAY_ORIGIN`, browser, compose-mode, ffmpeg, and runtime port settings.
- Provider keys, database URLs, billing configuration, model routing, pricing, and R2 credentials must not enter Worker build material or runtime environment.
- Preserve `predev` migration lineage through `0031`; do not import, rewrite, squash, or renumber migrations from `zeabur/deploy`.
- Keep Node 22 during this integration. A Node 24 upgrade is a separate change.
- Use RED → GREEN for behavior changes, one Conventional Commit per task, and update active deployment/configuration documentation with the code.

---

### Task 1: Repair the Predev Baseline on Cross-Platform Runners

**Files:**
- Modify: `src/lib/storage/local-fs.ts`
- Modify: `src/lib/storage/local-fs.test.ts`
- Modify: `src/features/render/media-ffmpeg-args.ts`
- Modify: `src/features/render/media-ffmpeg.test.ts`
- Modify: `src/features/director/tools/fabricate-runtime-probe.test.ts`

**Interfaces:**
- Consumes: existing `LocalFsStorage` and `escapeFilterPath(file: string): string`.
- Produces: host-independent path traversal rejection and host-independent FFmpeg escaping for Windows absolute paths.

- [ ] **Step 1: Preserve the observed RED evidence**

Run: `rtk pnpm exec vitest run src/lib/storage/local-fs.test.ts src/features/render/media-ffmpeg.test.ts`

Expected: `..\\outside.txt` is accepted on POSIX and `C:/...` is prefixed with the POSIX worktree path.

- [ ] **Step 2: Reject foreign-platform absolute and traversal keys**

Normalize `\\` to `/` for validation, reject POSIX absolute paths, Windows drive paths, UNC paths, empty segments that escape with `..`, then resolve the original normalized storage key under `root`.

- [ ] **Step 3: Preserve Windows absolute paths in FFmpeg filters**

Implement the equivalent of:

```ts
const absolute = path.win32.isAbsolute(file) || path.posix.isAbsolute(file)
  ? file
  : path.resolve(file)
```

Then normalize slashes and escape the FFmpeg filter metacharacters once.

- [ ] **Step 4: Make the real Chromium test resilient to suite contention**

Keep production deadlines unchanged; raise only the outer Vitest timeout for the successful runtime case to `30_000` so it still fails before the production total deadline.

- [ ] **Step 5: Verify and commit**

Run: `rtk pnpm exec vitest run src/lib/storage/local-fs.test.ts src/features/render/media-ffmpeg.test.ts src/features/director/tools/fabricate-runtime-probe.test.ts`

Expected: 3 files pass.

Commit: `fix(platform): harden cross-platform path contracts`

### Task 2: Replace GHCR Compose with the Zeabur Runtime Boundary

**Files:**
- Create: `Dockerfile.web`
- Create: `Dockerfile.worker`
- Create: `Dockerfile.migrate`
- Create: `deploy/zeabur.template.yaml`
- Modify: `.dockerignore`
- Modify: `.github/workflows/ci.yml`
- Modify: `deploy/README.md`
- Modify: `tests/deployment-config.test.ts`
- Delete: `Dockerfile`
- Delete: `server/Dockerfile`
- Delete: `deploy/Caddyfile`
- Delete: `deploy/compose.yaml`
- Delete: `deploy/env.example`
- Delete: `docker-compose.prod.yml`
- Delete: `scripts/deploy/validate-image-tag.mjs`
- Delete: `scripts/verify/predev-browser/**`
- Delete: `tests/predev-browser-contracts.test.ts`

**Interfaces:**
- Consumes: current standalone Web closure, minimal migration closure, Worker gateway contract, Zeabur internal DNS.
- Produces: four Zeabur services initially (`postgresql`, `web`, `worker`, `migrate`) with branch `zeabur/deploy`; Task 5 adds `backup`.

- [ ] **Step 1: Write the Zeabur deployment RED contract**

Replace GHCR assertions with tests that parse `deploy/zeabur.template.yaml` and require PostgreSQL `17.5`, Git sources on `zeabur/deploy`, no Caddy/image-tag guard/GHCR string, no Worker database/provider/R2 environment, and separate Web/Worker/Migrate Dockerfiles.

- [ ] **Step 2: Run the RED test**

Run: `rtk pnpm exec vitest run tests/deployment-config.test.ts`

Expected: fail because the Zeabur template and service Dockerfiles do not exist.

- [ ] **Step 3: Create the minimal service images**

Use Node 22, copy `patches/` and `packages/procedural-sfx/package.json` before frozen install, preserve non-root Chromium and ffmpeg behavior, keep Migrate to the migration source closure, and keep Worker working at `/repo/server` with only `src/features/ai/worker-gateway-contract.ts` from the Web tree.

- [ ] **Step 4: Create the Zeabur template**

Web receives database, provider, billing, mail, internal-key, and R2 settings. Worker receives only the allowed service contract and uses `http://web.zeabur.internal:3000` for `PURPLEINK_AI_GATEWAY_ORIGIN`. Migrate receives only `DATABASE_URL`.

- [ ] **Step 5: Remove GHCR-only runtime files and CI publishing**

CI must lint, typecheck, test, run PostgreSQL/workflow gates, build the application, and build Web/Worker/Migrate images with `push: false`. It must contain no registry login or package-write permission.

- [ ] **Step 6: Verify and commit**

Run: `rtk pnpm exec vitest run tests/deployment-config.test.ts tests/database-upgrade-gate-contract.test.ts`

Run: `rtk pnpm typecheck`

Expected: all pass.

Commit: `feat(deploy): establish Zeabur production runtime`

### Task 3: Restore R2 Write-Through Artifact Storage

**Files:**
- Create: `src/lib/storage/remote-store.ts`
- Create: `src/lib/storage/s3-remote-store.ts`
- Create: `src/lib/storage/s3-mirror.ts`
- Create: `src/lib/storage/s3-mirror.test.ts`
- Modify: `src/lib/storage/index.ts`
- Modify: `src/lib/storage/types.ts`
- Modify: `src/lib/storage/local-fs.test.ts`
- Modify: `src/lib/storage/cleanup-outbox.pg.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `RemoteObjectStore`, `S3RemoteStore`, and `S3MirrorStorage` implementing the existing `StorageAdapter`.
- Configuration: `STORAGE_MODE=local|s3-mirror`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

- [ ] **Step 1: Write RED storage contracts**

Test successful dual write, remote-required success, local cache fill after remote read, idempotent local/remote delete, remote delete failure propagation, unknown storage mode rejection, and missing R2 variable names without secret values.

- [ ] **Step 2: Run RED**

Run: `rtk pnpm exec vitest run src/lib/storage/s3-mirror.test.ts src/lib/storage/cleanup-outbox.pg.test.ts`

Expected: fail because the R2 modules and mode do not exist.

- [ ] **Step 3: Implement the minimal adapters**

Use `@aws-sdk/client-s3` with path-style addressing. `put` succeeds only after local and remote writes; `get` prefers local then fills it from remote; `delete` is idempotent and propagates remote failures so Cleanup Outbox retries.

- [ ] **Step 4: Verify and commit**

Run: `rtk pnpm exec vitest run src/lib/storage/local-fs.test.ts src/lib/storage/s3-mirror.test.ts src/lib/storage/cleanup-outbox.pg.test.ts`

Expected: all pass against the existing cleanup semantics.

Commit: `feat(storage): restore R2 artifact persistence`

### Task 4: Add Hash-Gated R2 Presigned Delivery

**Files:**
- Create: `src/features/artifacts/presign.ts`
- Create: `src/features/artifacts/presign.test.ts`
- Modify: `src/features/artifacts/index.ts`
- Modify: `src/features/artifacts/service.ts`
- Modify: `src/app/api/artifacts/[id]/route.ts`
- Modify: `src/app/api/artifacts/[id]/route.test.ts`
- Modify: `src/lib/storage/remote-store.ts`
- Modify: `src/lib/storage/s3-remote-store.ts`
- Modify: `src/lib/storage/s3-mirror.ts`
- Modify: `src/lib/storage/s3-mirror.test.ts`
- Modify: `src/lib/storage/index.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `getArtifactDownloadRedirect(projectId, artifactId, { attachment })` returning `string | null`.
- Produces: remote object metadata `content-sha256` and a presign operation that verifies expected hash metadata before signing protected final video artifacts.

- [ ] **Step 1: Write RED route and metadata tests**

Require 302 only after session, workspace, delivery, readiness, and content-hash gates; require protected videos to fail closed when remote hash metadata is absent or mismatched; keep local mode streaming and byte hashing unchanged.

- [ ] **Step 2: Run RED**

Run: `rtk pnpm exec vitest run src/features/artifacts/presign.test.ts src/app/api/artifacts/[id]/route.test.ts src/lib/storage/s3-mirror.test.ts`

Expected: fail because presign capability and hash metadata are absent.

- [ ] **Step 3: Implement hash-aware signing**

Store the SHA-256 of uploaded bytes as R2 object metadata. Before signing a `final-mp4` or `website-video-mp4`, issue `HeadObject` and compare metadata with the registered Artifact hash. Generate response content type and optional attachment disposition only after the comparison succeeds.

- [ ] **Step 4: Verify and commit**

Run: `rtk pnpm exec vitest run src/features/artifacts/presign.test.ts src/app/api/artifacts/[id]/route.test.ts src/lib/storage/s3-mirror.test.ts`

Expected: all pass; local delivery remains 200 and R2 delivery returns guarded 302.

Commit: `feat(artifacts): add hash-gated R2 downloads`

### Task 5: Add Verified PostgreSQL Backups to R2

**Files:**
- Create: `Dockerfile.backup`
- Create: `scripts/backup/rotation.ts`
- Create: `scripts/backup/pg-backup-r2.ts`
- Create: `scripts/backup/run-backup.ts`
- Create: `scripts/backup/schedule.ts`
- Create: `tests/pg-backup-rotation.test.ts`
- Create: `tests/pg-backup-contract.test.ts`
- Modify: `deploy/zeabur.template.yaml`
- Modify: `tests/deployment-config.test.ts`

**Interfaces:**
- Produces: daily `pg_dump -Fc`, SHA-256 calculation, R2 upload, remote size verification, and retain-count rotation.
- Configuration: `DATABASE_URL`, R2 variables, `PG_BACKUP_PREFIX`, `PG_BACKUP_RETAIN`.

- [ ] **Step 1: Write RED backup contracts**

Test deterministic object keys, retain-count selection, secret-safe failure messages, PostgreSQL client 17 in the Dockerfile, and a Zeabur Backup service with only database/R2/backup settings.

- [ ] **Step 2: Run RED**

Run: `rtk pnpm exec vitest run tests/pg-backup-rotation.test.ts tests/pg-backup-contract.test.ts tests/deployment-config.test.ts`

Expected: fail because Backup service and scripts are absent.

- [ ] **Step 3: Implement and verify the backup pipeline**

Write to a unique temporary directory, reject empty dumps, upload, verify `ContentLength`, rotate only after successful verification, and always remove the temporary directory.

- [ ] **Step 4: Verify and commit**

Run: `rtk pnpm exec vitest run tests/pg-backup-rotation.test.ts tests/pg-backup-contract.test.ts tests/deployment-config.test.ts`

Expected: all pass.

Commit: `feat(backup): persist PostgreSQL archives to R2`

### Task 6: Synchronize Zeabur and R2 Documentation

**Files:**
- Create: `docs/deployment/zeabur-plan.md`
- Create: `docs/deployment/zeabur-setup.md`
- Create: `docs/integration/zeabur-predev-integration-2026-08-02.md`
- Modify: `.env.example`
- Modify: `deploy/README.md`
- Modify: `docs/configuration/credentials.md`
- Modify: `README.md`
- Delete: `docs/deployment/access.md`
- Delete: `docs/deployment/runbook.md`

**Interfaces:**
- Produces: one active deployment truth describing Zeabur Git builds, PostgreSQL 17.5, R2 Artifact persistence, R2 backups, restore drills, and Worker secret boundaries.

- [ ] **Step 1: Write documentation contract assertions**

Extend `tests/deployment-config.test.ts` to require the active Zeabur paths and prohibit active GHCR/Caddy/immutable-image guidance.

- [ ] **Step 2: Run RED, write exact operational docs, and run GREEN**

Run: `rtk pnpm exec vitest run tests/deployment-config.test.ts tests/env.test.ts`

Expected before docs: fail; expected after docs: pass.

- [ ] **Step 3: Record accepted and rejected branch scopes**

The integration ledger must list the locked branch SHAs, accepted Zeabur deployment/R2/marketing commits, rejected GHCR/old Worker/provider/migration scopes, commands actually run, and unresolved acceptance items without claiming them passed.

- [ ] **Step 4: Commit**

Commit: `docs(deploy): align Zeabur and R2 operations`

### Task 7: Reconcile the Latest Zeabur Marketing Hardening

**Files:**
- Modify only files proven necessary from `zeabur/deploy@4ad0447` under `src/components/marketing/**`
- Modify matching tests under `src/components/marketing/**`
- Modify: `docs/integration/zeabur-predev-integration-2026-08-02.md`

**Interfaces:**
- Consumes: predev responsive, reduced-motion, OverlayRoot, and Community behavior.
- Produces: accepted interaction fixes from `4ad0447` without replacing predev business or design contracts.

- [ ] **Step 1: Audit the commit file by file**

Compare `4ad0447^..4ad0447` against the current predev implementation. Record each file as already present, accepted and adapted, or rejected with reason.

- [ ] **Step 2: Add RED tests only for missing accepted behavior**

Run the focused marketing contract tests and confirm each new assertion fails for the intended missing behavior.

- [ ] **Step 3: Apply the minimal interaction changes**

Do not replace predev responsive or routing behavior wholesale.

- [ ] **Step 4: Verify and commit**

Run: `rtk pnpm exec vitest run src/components/marketing tests/marketing-runtime-contract.test.ts`

Expected: focused marketing suite passes.

Commit: `fix(marketing): reconcile Zeabur interaction hardening`

### Task 8: Final Verification and Provenance Merge

**Files:**
- Modify: `docs/integration/zeabur-predev-integration-2026-08-02.md`
- Modify: `docs/minipowers/plans/2026-08-02-zeabur-predev-integration.md` checkbox state only if maintained during execution

**Interfaces:**
- Produces: a final merge commit whose first-parent tree is the verified integration tree and whose second parent is `origin/zeabur/deploy@fffd93698fa6553a42409e8a45517bf88aac9cb5`.

- [ ] **Step 1: Run complete fresh verification**

Run all of:

```text
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm --filter purpleink-server typecheck
rtk pnpm --filter @purpleink/procedural-sfx typecheck
rtk pnpm test
rtk pnpm test:pg:isolated
rtk pnpm verify:v3
rtk pnpm verify:workflow
rtk pnpm build
rtk pnpm exec vitest run tests/deployment-config.test.ts tests/pg-backup-contract.test.ts
rtk git diff --check
```

Build all four Dockerfiles with local verification tags and run non-root, Chromium, ffmpeg/ffprobe, Worker environment, and Migrate closure checks.

- [ ] **Step 2: Perform the no-tree-change provenance merge**

Record `HEAD^{tree}`, run `rtk git merge -s ours --no-ff origin/zeabur/deploy`, then require `HEAD^1^{tree}` and `HEAD^{tree}` to be identical.

- [ ] **Step 3: Re-run final branch gates and record evidence**

Do not push. Record exact pass/fail/blocked results and the final commit SHA in the integration ledger.

Commit any post-merge ledger update as: `docs(integration): record Zeabur merge acceptance`
