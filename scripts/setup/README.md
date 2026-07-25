# scripts/setup

环境初始化脚本。

## Postgres runtime

应用和 worker 的活动结构化数据只使用 Postgres。执行
`pnpm db:migrate` 会调用 `db-migrate.ts`，从服务端 `DATABASE_URL` 读取目标，
显式应用仓库中已提交的 Postgres migration；模块导入不会自动连接或迁移。

## Legacy SQLite migration

SQLite 仅保留为只读迁移工具的输入，不再有应用 runtime 默认数据库路径。备份、
导出与对账命令位于 `scripts/migration/`，源文件必须由调用者通过
`--source`、`--snapshot` 等 CLI 参数显式提供；这些脚本不得从应用配置推导源路径。
