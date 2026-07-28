---
kind: external_dependency
name: Drizzle ORM 数据库操作
slug: drizzle-orm
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - drizzle.config.ts
    - package.json
---

使用 Drizzle ORM 进行数据库操作，配合 drizzle-kit 进行迁移管理。数据库 schema 定义在 drizzle.config.ts 中，迁移脚本位于 scripts/migration/。Postgres 集成测试通过 vitest.pg.config.ts 配置执行。