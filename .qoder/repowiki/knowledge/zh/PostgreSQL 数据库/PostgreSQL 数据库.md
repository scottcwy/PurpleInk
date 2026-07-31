---
kind: external_dependency
name: PostgreSQL 数据库
slug: postgresql
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### PostgreSQL 数据库服务
- 使用 postgres:17.5-alpine 镜像作为唯一结构化业务数据源
- 通过 docker-compose.prod.yml 管理，端口不对外暴露，仅容器间通信
- 数据持久化到 cvc_postgres_prod 卷，需定期备份
- 迁移脚本位于 scripts/setup/db-migrate.ts，使用 drizzle-kit
- 生产环境要求强口令，禁止沿用开发环境的默认密码
- 健康检查通过 pg_isready 命令验证连接状态