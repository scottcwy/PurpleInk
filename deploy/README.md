# PurpleInk dev deployment

This deployment intentionally exposes only Caddy on TCP ports 80 and 443.
The public site is available without a shared password, while `/api` and
`/api/*` return 404 until application-level authentication is implemented.

## Server layout

```text
/opt/purpleink/
  compose.yaml
  Caddyfile
  .env
  .env.worker
  data/
```

The Worker writes capture caches, generated HyperFrames projects, and rendered
videos under `data/`. Job metadata is currently in memory and does not survive
a Worker restart, so deploy only when no render job is running.

## Images

The `dev-images.yml` workflow publishes private, amd64-only images to GHCR:

```text
ghcr.io/scottcwy/purpleink-web:dev
ghcr.io/scottcwy/purpleink-web:sha-<commit>
ghcr.io/scottcwy/purpleink-worker:dev
ghcr.io/scottcwy/purpleink-worker:sha-<commit>
```

Pin `IMAGE_TAG` to the immutable `sha-*` tag. The mutable `dev` tag is for
discovery, not deployment or rollback.

## Secrets

Do not commit `.env` or `.env.worker`. The server GHCR credential must have
read-only package access. Worker API and provider credentials belong only in
`.env.worker`, with file mode `600`.
