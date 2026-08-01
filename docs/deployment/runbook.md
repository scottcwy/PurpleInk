# Immutable GHCR production runbook

This runbook deploys the three immutable application images defined by
`deploy/compose.yaml`: Web, Worker, and Migrate. Use Docker Compose **2.20.0
or later**. `docker-compose.prod.yml` is a compatibility entrypoint that only
includes that file; it is not a second production stack.

Only the `dev` branch may publish images to GHCR after every CI gate succeeds.
Published application images use a full immutable tag:

```text
ghcr.io/scottcwy/purpleink-web:sha-<40 lowercase hex>
ghcr.io/scottcwy/purpleink-worker:sha-<40 lowercase hex>
ghcr.io/scottcwy/purpleink-migrate:sha-<40 lowercase hex>
```

The `dev` tag is discovery-only and must never be deployed or used for
rollback.

## Prepare

Copy `deploy/env.example` to the untracked `deploy/.env`, replace every
placeholder, and limit access to the deployment account. Do not place secrets
in images, Compose files, logs, source control, or chat.

Set `PURPLEINK_IMAGE_TAG` to a full `sha-<40 lowercase hex>` tag and verify
both Compose entrypoints before touching the running stack:

```powershell
$env:PURPLEINK_IMAGE_TAG = (Get-Content deploy/.env | Where-Object { $_ -match '^PURPLEINK_IMAGE_TAG=' } | ForEach-Object { $_ -replace '^PURPLEINK_IMAGE_TAG=', '' })
node scripts/deploy/validate-image-tag.mjs $env:PURPLEINK_IMAGE_TAG
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f docker-compose.prod.yml config --quiet
```

Stop if either command fails.

## Deploy

Web has a single production replica and a 120-second graceful stop period.
Caddy is the only published service and retains the SSE flush behavior and
security headers documented in `access.md`.

Worker intake is limited to public website capture through the authenticated
application workflow. It does not receive IMAP or signup credentials, and it
must not be repurposed as an email or account-registration ingestion service.

```powershell
docker compose --env-file deploy/.env -f deploy/compose.yaml pull
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --wait postgres
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm migrate
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm migrate
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --wait worker web caddy
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Migrations are forward-only. They must succeed twice consecutively before the
application cutover. Never use a down migration or skip a failed migration.

## Health, recovery, and rollback

Check Web through its container `/api/ping`, Worker through `/health`, and
Postgres with `pg_isready`. PostgreSQL time is the lifecycle source of truth.
Before deployment, after migration, and after abnormal restart, run
`pnpm verify:workflow`; reconcile terminal attempt invocations, leases,
tickets, orphan dispatches, epoch mismatches, and Artifact evidence before
recovery. The verifier audits the current contract and must not fabricate
historical telemetry or approved/released Artifacts.

To roll back, select a previously verified full SHA image tag whose application
version remains forward-compatible with the current database, repeat tag and
Compose validation, then repeat the migration and startup sequence. Do not use
`dev`, mutate a published SHA tag, force-push, or roll back the database.

## Persistent data and backup

Back up `cvc_data` (Artifact bytes) together with `cvc_postgres_prod`
(structured business, queue, and ledger truth). Keep restore exercises for
Postgres backups and Artifact consistency. `cvc_worker_out` and
`cvc_worker_capture` are transient media runtime data, not a second task
database. Do not run `docker compose down --volumes` during normal operations.
