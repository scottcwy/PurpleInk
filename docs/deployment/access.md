# Production access and network boundary

`deploy/compose.yaml` and `deploy/Caddyfile` are the production topology
source of truth. Docker Compose **2.20.0 or later** is required because the
compatibility entrypoint uses Compose `include`.

```text
Internet
  80/443 -> Caddy (edge + app) -> Web :3000 (app + data) -> Postgres (data)
                                      -> Worker :8787 (app only)
Migrate (data only)                  Image tag guard (network_mode: none)
```

- Caddy is the only service with host ports, publishing 80 and 443 only.
- `edge` is for the public reverse proxy. `app` is a normal private bridge
  for Caddy-to-Web and Web-to-Worker traffic. `data` is an internal Docker
  network shared only by Web, Migrate, and Postgres.
- Worker never joins `data` and therefore has no database route. It calls the
  internal AI gateway at `http://web:3000` with the service-to-service key.
- Worker receives only its engine key, gateway origin, browser and media
  runtime controls. Provider credentials, model/price/billing configuration,
  database access, IMAP, and signup values remain outside its environment.
- Web owns database access, `DATA_DIR`, `BACKEND_ORIGIN`, credential master
  key, redemption pepper, queue settings, managed-provider credentials, and
  mail credentials.

## Caddy contract

Application session authentication is the only user-authentication layer;
there is no reverse-proxy Basic Auth. Caddy provides TLS, CIDR filtering,
security headers, and SSE proxying. Set `CVC_ALLOWED_CIDRS` to the approved
VPN or office egress ranges before production use.

`deploy/Caddyfile` must retain the security headers, hide the upstream server
header, and use `flush_interval -1` for `reverse_proxy web:3000` so SSE frames
are not buffered. It does not expose an unauthenticated health or management
endpoint.

## Acceptance checks

- The resolved Compose configuration has host ports only on Caddy.
- The host cannot directly reach Web, Worker, or Postgres.
- Worker cannot join or resolve the data network; it communicates with Web via
  the app bridge only.
- Caddy preserves security headers and delivery of an idle SSE stream.
