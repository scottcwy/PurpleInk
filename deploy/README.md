# PurpleInk production Compose files

Production truth is `compose.yaml`; `../docker-compose.prod.yml` is a
Compose 2.20.0+ compatibility entrypoint that includes it unchanged.

Deploy only immutable `sha-<40 lowercase hex>` GHCR images. The `dev` tag is
for discovery and is never a deployment target. Copy `env.example` to the
untracked `.env`, validate the image tag, then validate both Compose entrypoints
before pulling or starting services. See `../docs/deployment/runbook.md` for
the full deployment, backup, recovery, and SHA rollback procedure.

Caddy is the only public service (80/443). It keeps TLS, CIDR filtering,
security headers, and unbuffered SSE proxying. Web has a 120-second graceful
stop period; Worker has no database or provider-credential environment.
