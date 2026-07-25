# PurpleInk production deployment

Only Caddy publishes TCP ports 80 and 443. The Next.js Web service proxies
`/api/engine/*` to the Docker-internal Worker through `BACKEND_ORIGIN`.

## Server layout

```text
/opt/purpleink/
  compose.yaml
  Caddyfile
  .env
  .env.worker
  data/
```

Copy `env.example` to `.env` and `worker.env.example` to `.env.worker` on the
server, then replace every placeholder. Keep both files mode `600` and never
commit them.

The Worker keeps generated captures, projects, and videos under `data/`. Job
metadata is in memory, so deploy only when no render job is running.

## Images

GitHub Actions publishes private amd64 images from `main`:

```text
ghcr.io/scottcwy/purpleink-web:main
ghcr.io/scottcwy/purpleink-web:sha-<commit>
ghcr.io/scottcwy/purpleink-worker:main
ghcr.io/scottcwy/purpleink-worker:sha-<commit>
```

Set `IMAGE_TAG` to the immutable `sha-*` tag. The mutable `main` tag is only
for discovering the newest build, never for deployment or rollback.

## Deploy

```bash
docker compose config --quiet
docker compose pull web worker
docker compose up -d --wait worker web
docker compose up -d caddy
docker compose ps
```
