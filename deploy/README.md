# PurpleInk production deployment

Only Caddy publishes TCP ports 80 and 443. PostgreSQL, Web, and Worker stay on
the Docker-internal network. The Next.js Web service proxies `/api/engine/*`
to Worker through `BACKEND_ORIGIN`.

## Server layout

```text
/opt/purpleink/
  compose.yaml
  Caddyfile
  .env
  data/
```

Copy `env.example` to `.env` on the server, then replace every placeholder.
`POSTGRES_PASSWORD` must be URL-safe because the same value appears in
`DATABASE_URL`. Generate it with `openssl rand -hex 32`; generate
`CVC_CREDENTIAL_MASTER_KEY` with `openssl rand -base64 32`. Keep the file
mode `600` and never commit it. The same `.env` also feeds the Worker service
(`env_file`), which consumes only the worker section at the bottom of the
template.

PostgreSQL data is stored in the `postgres_data` named volume. Do not use
`docker compose down --volumes` during normal deploys or rollbacks.

The Worker keeps generated captures, projects, and videos under `data/`. Job
metadata is in memory, so deploy only when no render job is running.

## Images

GitHub Actions publishes private amd64 images from `main`:

```text
ghcr.io/scottcwy/purpleink-web:main
ghcr.io/scottcwy/purpleink-web:sha-<commit>
ghcr.io/scottcwy/purpleink-worker:main
ghcr.io/scottcwy/purpleink-worker:sha-<commit>
ghcr.io/scottcwy/purpleink-migrate:main
ghcr.io/scottcwy/purpleink-migrate:sha-<commit>
```

Set `IMAGE_TAG` to the immutable `sha-*` tag. The mutable `main` tag is only
for discovering the newest build, never for deployment or rollback.

## Deploy

```bash
docker compose config --quiet
docker compose pull web worker migrate
docker compose up -d --wait postgres
docker compose --profile tools run --rm migrate
docker compose up -d --wait worker web
docker compose up -d caddy
docker compose ps
```

Run the migration command a second time during verification. Migrations are
idempotent, and the second run must also exit successfully before deployment.
