# PurpleInk production deployment

Zeabur Git builds are the only production deployment path. Import
`deploy/zeabur.template.yaml`; its application services build from branch
`zeabur/deploy` using `Dockerfile.web`, `Dockerfile.worker`, and
`Dockerfile.migrate`.

The initial template creates PostgreSQL 17.5, Web, Worker, and Migrate. Web owns
the database, provider, billing, mail, service-key, and R2 configuration. Worker
receives only its rendering service contract and calls the Web AI gateway at
`http://web.zeabur.internal:3000`. Migrate receives only `DATABASE_URL`.

Secret values stay empty in the template and must be supplied through the
Zeabur service Variables panels. The detailed setup, backup, restore, and
acceptance runbooks are synchronized in the documentation task.
