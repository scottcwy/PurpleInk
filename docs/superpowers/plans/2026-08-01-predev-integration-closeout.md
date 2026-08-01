# PurpleInk predev Integration Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` task-by-task. Every task needs an implementation review and a quality review before the next task.

**Goal:** Turn the audited `predev` integration into a reproducible, immutable-image candidate without regressing the yusheng workflow, billing, Artifact, queue, Provider, or database contracts.

**Architecture:** `predev` remains a content-first integration branch rooted at `yusheng/two-part-merge`. Dev marketing/community and penguin admin product surfaces are already ported as ordinary commits; deployment is rebuilt around three immutable GHCR application images, Caddy as the sole public entrypoint, a private application network, and an isolated data network. Donor branches are attached only by no-tree-change provenance merges after validation.

**Tech Stack:** Next.js 16, TypeScript, pnpm 10.30.0, PostgreSQL/Drizzle, Vitest, Playwright, Docker Compose, Caddy, GitHub Actions, GHCR.

---

## Locked inputs and hard stops

- Base: `yusheng/two-part-merge@2cb33c9a680722968c539917c21350e34bea0815`.
- Dev donor: `d85e9ec204bf45b736b3ba4749b3545b42476edb`.
- Penguin donor: `14dcfaa657249fa9921dc812cb99d0578d244c0a`.
- Work only in the existing `predev` worktree; the original checkout stays on `yusheng/two-part-merge`.
- Stop before release if any donor SHA changes, `origin/predev` appears, a standard final gate fails, an image fails to run, or an `ours` merge changes the tree.
- Never force-push, modify `dev`, invoke a paid provider, use real production credentials, or alter the existing local development database.

## Task 1: Make immutable deployment production-safe

**Files:**

- Modify: `.dockerignore`, `Dockerfile`, `server/Dockerfile`, `docker-compose.prod.yml`, `package.json`.
- Create/modify: `.github/workflows/ci.yml`, `deploy/{Caddyfile,README.md,compose.yaml,env.example}`, `scripts/deploy/validate-image-tag.mjs`, `tests/deployment-config.test.ts`.
- Modify: `docs/deployment/{access.md,runbook.md}`.
- Delete: `deploy/reverse-proxy/**` after active documentation no longer references it.

- [ ] Write failing deployment-contract tests for three networks, no Worker database/provider/billing environment, Worker runtime path/ffmpeg, minimal Migrate source closure, immutable tags, and the CI publish boundary.
- [ ] Run `pnpm exec vitest run tests/deployment-config.test.ts` and record expected RED failures.
- [ ] Implement `edge` (Caddy only), `app` (Caddy/Web/Worker egress-capable bridge), and `data` (`internal: true`, Web/Migrate/Postgres only). Caddy is the only service with host ports 80/443.
- [ ] Keep Web responsible for database, Artifact, master key, redemption pepper, provider/mail settings, and queue concurrency. Restrict Worker to the service key, AI gateway, and media runtime configuration.
- [ ] Change Worker runtime to `/repo/server`, install `ffmpeg`/`ffprobe`, use installed Playwright tooling, and mount its real `out`/`capture` paths.
- [ ] Keep Web runtime to standalone/static/public/assets and non-root Chromium. Make Migrate copy only its migration entrypoint, tsconfig, DB migrate module, schema, and migration directory.
- [ ] Keep `PURPLEINK_IMAGE_TAG` to `sha-<40 lowercase hex>` for deployment and rollback. PR/predev build but do not authenticate/push; only `dev` publishes `sha-${GITHUB_SHA}` plus discovery-only `dev` tags.
- [ ] Preserve Caddy SSE/security headers, single-Web lifecycle, 120-second stop grace, PostgreSQL clock/workflow recovery guidance, durable-volume backup guidance, and forward-only migration/rollback rules in active deployment docs.
- [ ] Run target tests, Compose config for both entrypoints, tag validation, typechecks, `pnpm verify:v3`, `git diff --check`, and real Web/Migrate/Worker image builds plus non-root/Chromium/ffmpeg/runtime-network checks.
- [ ] Stage only audited deployment files and commit `feat(deploy): add immutable GHCR production stack`.
- [ ] Record exact staged paths and verification evidence in `docs/integration/predev-2026-08-01.md`; commit `docs(integration): record immutable deployment batch`.

## Task 2: Add repeatable final HTTP and Chromium acceptance

**Files:**

- Create: small `scripts/verify/predev-browser/**` helpers and a single acceptance entrypoint.
- Test: focused Vitest coverage for the script's stable pure helpers/contract parsing.
- Modify: `docs/integration/predev-2026-08-01.md`.

- [ ] Write RED tests for evidence manifests, no-secret redaction, the admin guard matrix, and Community media range/hash verification.
- [ ] Implement a temporary external Compose override and random ephemeral configuration. It may expose only its own Postgres on loopback and must be destroyed by exact project name after the run.
- [ ] Seed a temporary user without printing credentials, promote only that account using `admin:set-role`, and run migrations twice.
- [ ] Capture `/` and `/community` at desktop/mobile, light/dark, and reduced-motion; assert header hide/restore, mobile menu, theme switch, Community playback, and no browser errors.
- [ ] Capture dev donor marketing baseline from an exact temporary archive using the same matrix; compare behavioral contracts, not stale pixel equality.
- [ ] Verify four Community WebP/MP4 pairs with `ffprobe`, SHA-256, full download hash, and an HTTP `Range`/`206` response.
- [ ] Verify unauthenticated 401/redirect, ordinary-user 404/notFound, and admin success across all seven admin pages and registered APIs. Exercise account creation, disable/restore/session invalidation, last-admin protection, one-time redemption plaintext, redemption, and revoke.
- [ ] Verify Caddy/Web/Worker health, published-port exclusivity, networks, durable volumes, and restart behavior without real AI calls.
- [ ] Persist only redacted evidence under ignored `.data/integration-evidence/<commit>/`; commit the script as `test(integration): automate predev HTTP and Chromium acceptance` and ledger facts as `docs(integration): record browser and runtime acceptance`.

## Task 3: Prove migration and full quality readiness

- [ ] Verify a fresh isolated database migrates twice.
- [ ] Create an isolated 0028 baseline from the yusheng archive, upgrade with current predev migrations, then run migrations again twice.
- [ ] Prove historical users remain global `user`, new role/counter/index contracts exist, and forbidden penguin tables/migrations are absent.
- [ ] Run the standard full gates without relaxing timeouts: lint, root/server/package typechecks, root/package tests, PG tests, architecture, workflow integrity, production build, standalone contract, Compose config, all image builds, diff check, strict UTF-8 decode, and U+FFFD scan.
- [ ] Treat any failed or timed-out standard full command as a release blocker. A focused sequential retry diagnoses a failure but does not replace the standard green command.

## Task 4: Record donor provenance and publish only a validated candidate

- [ ] Re-run `git ls-remote`; require all locked donor SHA values and an absent `origin/predev`.
- [ ] Create `-s ours --no-ff` provenance merges for dev then penguin. Each message lists accepted and rejected scopes. Compare `HEAD^1^{tree}` with `HEAD^{tree}` immediately after each merge and stop on mismatch.
- [ ] Prove yusheng, dev, and penguin tips are all ancestors of `predev`.
- [ ] Add merge SHAs, tree hashes, ancestor proof, exact final commands, and explicit real-provider-E2E waiver to the integration ledger; commit `docs(integration): record donor provenance and final acceptance`.
- [ ] Re-run final standard gates at final HEAD, then non-force push `predev`.
- [ ] Wait for the remote predev quality, PostgreSQL/workflow, and three-image CI jobs. On CI failure, fix only the owning boundary, re-run full gates, and push a new `predev` commit; do not tag a failing candidate.
- [ ] After green CI, create and push `candidate/2026-08-01/predev-<HEAD12>` with source SHAs, final SHA, CI URL, and the no-paid-provider-E2E statement. Verify remote branch and dereferenced tag point to the same SHA.
- [ ] Do not create a PR or promote `predev` to `dev`; that remains an explicit later authorization.

## Acceptance invariants

- No `render_jobs`, worker job-db, secondary queue, legacy billing queries, penguin `0019/0020`, or second app/admin shell may be introduced.
- The Worker never holds provider credentials, model routing, prices, billing logic, or a database connection.
- Database migrations are additive and forward-only; approved/released Artifact and double-ledger history are never rewritten.
- Screenshots, downloaded media, temporary secrets, cookies, databases, and Docker logs remain ignored; only redacted evidence and hashes enter the ledger.
