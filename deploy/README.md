# PurpleInk production deployment

Zeabur Git builds are the only production deployment path. Import
`deploy/zeabur.template.yaml`; its application services build from branch
`zeabur/deploy` using `Dockerfile.web`, `Dockerfile.worker`,
`Dockerfile.migrate`, and `Dockerfile.backup`.

The template creates PostgreSQL 17.5, Web, Worker, Migrate, and Backup. Web owns
the database, provider, billing, mail, service-key, and Artifact R2
configuration. Worker receives only its rendering service contract and calls the
Web AI gateway at `http://web.zeabur.internal:3000`. Migrate receives only
`DATABASE_URL`. Backup is a private service (no exposed port) that daily archives
PostgreSQL to R2 with `DATABASE_URL` + `S3_*` + `PG_BACKUP_PREFIX` +
`PG_BACKUP_RETAIN`.

Secret values stay empty in the template and must be supplied through the Zeabur
service Variables panels.

## Active documentation

- Architecture truth: [docs/deployment/zeabur-plan.md](../docs/deployment/zeabur-plan.md)
- Setup and operations: [docs/deployment/zeabur-setup.md](../docs/deployment/zeabur-setup.md)
- Integration ledger: [docs/integration/zeabur-predev-integration-2026-08-02.md](../docs/integration/zeabur-predev-integration-2026-08-02.md)

## Restore drill

Before any production restore decision, run the isolated drill (disposable
PostgreSQL 17.5 source/destination containers plus MinIO, generated test-only
credentials):

```bash
pnpm tsx scripts/verify/pg-backup-restore-drill.ts
```

The drill never touches Zeabur, R2, or production credentials.
