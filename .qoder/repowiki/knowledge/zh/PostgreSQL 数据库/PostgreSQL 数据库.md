---
kind: external_dependency
name: PostgreSQL 数据库
slug: postgresql
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - docker-compose.dev.yml
    - drizzle.config.ts
    - .env.example
---

本地 Postgres 通过 docker-compose.dev.yml 提供，容器名为 purpleink-dev-postgres-1，用户名 cvc，数据库名 cvc。迁移使用 drizzle-kit，连接字符串在 .env.local 中配置。所有结构化业务数据以 Postgres 为唯一真值源，禁止新增 SQLite 运行依赖或双写路径。