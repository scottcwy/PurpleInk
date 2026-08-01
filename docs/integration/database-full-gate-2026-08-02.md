# Predev database full-gate ledger — 2026-08-02

## Scope

This closeout used disposable local PostgreSQL containers only. It did not use
the developer Compose project, its volume, `DATABASE_URL`, or
`TEST_DATABASE_URL` from local environment files.

## Database upgrade evidence

`pnpm tsx scripts/verify/database-upgrade-gate.ts` passed.

- `gate_empty`: applied the current migration directory through `0031` twice.
- `gate_archive`: extracted `src/lib/db/migrations/pg` from
  `2cb33c9a680722968c539917c21350e34bea0815`, applied the archive baseline
  through `0028`, inserted one legacy user, then applied current `0029` through
  `0031` twice.
- Both resulting databases have 32 tracked current migrations, a non-null
  `users.role` default of `user`, an empty `api_access_counters` table, and the
  three admin query indexes introduced by `0030` and `0031`.
- The archive user remains `role = user`; `render_jobs` is absent. The current
  yusheng `0019_project_purge_exemption` and `0020_provider_dispatch_tickets`
  remain the only migrations at those sequence numbers, so no penguin
  migration lineage was introduced.

## PostgreSQL tests

- The admin focus set passed on a separate disposable database: 4 files / 13
  tests (`admin-foundation`, `account-billing`, `operational-dashboards`, and
  `ai-audit`). This covers global role and last-admin concurrency, disable and
  restore, redemption, task projections, and AI audit projections.
- Full `pnpm test:pg` was attempted twice on separate disposable databases.
  Both attempts ran more than 180 seconds without a Vitest result and were
  explicitly terminated; therefore full PG is **not accepted** in this ledger.
  The temporary containers were removed after each attempt.
- The reproducible full-suite command is now `pnpm test:pg:isolated`. It starts
  a disposable `postgres:17.5-alpine` container, overwrites both inherited
  `DATABASE_URL` and `TEST_DATABASE_URL` for the child process with that
  container's loopback URL, and removes the exact container in `finally`.
  `tests/database-upgrade-gate-contract.test.ts` locks that override behavior;
  this command may only be recorded as passed when Vitest returns its final
  success result.

## Full quality gates

| Gate | Result |
| --- | --- |
| `pnpm lint` | passed after removing a dead `stderr` accumulator in the predev acceptance runner |
| `pnpm typecheck` | passed |
| `pnpm test` | passed: 275 files / 1802 tests |
| `pnpm verify:v3` | passed: `ok: true`, no violations |
| `pnpm verify:workflow` | passed: zero blocking violations; 1702 historical timestamp findings remain advisory |
| `pnpm build` | passed |
| `node --test scripts/verify/standalone-artifact-contract.mjs` | passed |
| both production Compose `config --quiet` checks | passed |
| `git diff --check` | passed |
| U+FFFD scan of `AGENTS.md`, `README.md`, `docs`, `src`, `server`, and `scripts` | passed |

## Gate repairs

- `postgres-migrator.test.ts` had retained an assertion for a schema argument
  that the immutable migrate image intentionally removed. The test now asserts
  the schema-free migrator call.
- `mutation-request.test.ts` had counted cold route-module loading inside its
  first 5-second request assertion. The route is now loaded during test-file
  initialization; the request timeout itself was not changed. The focused test
  and the complete unit suite passed afterwards.
- The database upgrade gate now reads `pg_get_indexdef` and requires the exact
  table, column order, direction, and `NULLS LAST` definitions for all three
  administrator indexes. It also reads `pg_get_constraintdef` and requires the
  `users_role_check` enum to be exactly `user | admin`.

No migration, workflow, queue, artifact, provider, or database contract was
modified by this closeout.
