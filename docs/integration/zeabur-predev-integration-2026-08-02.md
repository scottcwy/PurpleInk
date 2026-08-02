# Zeabur predev 集成总账（2026-08-02）

本文件记录 `zeabur/predev-integration` 集成的锁定 SHA、接受/拒绝范围、实际
执行的命令与证据，以及未决事项。只记录事实，不虚构结果；只写变量名，不回显
值。

## 1. 锁定 SHA

| 角色 | 引用 | 完整 SHA | 状态 |
| --- | --- | --- | --- |
| 集成基线 | `origin/predev` | `ad5d25684e3d21fb05437fd5c31da280e211b12a` | 锁定 |
| 计划锁定 donor | `zeabur/deploy` | `fffd93698fa6553a42409e8a45517bf88aac9cb5` | 计划锁定（Task 8 provenance merge 目标） |
| 当前 donor | `origin/zeabur/deploy` | `cef193e70857689c034036c4c8f2684d26545854` | **与计划锁定分叉**：Task 8 审计分叉后再决策；未声明祖先关系 |
| 合并前 tree | 待 Task 8 记录 | — | 未决 |

## 2. 接受范围（Task 1–5）

| Commit（完整 SHA） | 说明 | 验证证据（一行） |
| --- | --- | --- |
| `ac3fad164254f1ee9314cdfa3a8deff4db64b690` | fix(platform): 跨平台路径合同加固 | Task 1：控制器聚焦 3 文件 / 19 测试通过 |
| `1d6329b374afdea146d4ed17a6393426d4d1ede3` | feat(deploy): 建立 Zeabur 生产运行时 | Task 2：控制器 2 文件 / 10 测试通过，评审通过 |
| `62d54694d49a99c0b12400f1c8ef8b14d2de8150` | fix(deploy): 向 Web 构建传入站点 URL | Task 2 收尾，评审通过 |
| `fc83a63c729a140114accc7d78d267fb8e7fd3a6` | feat(storage): 增加 R2 Artifact 持久化 | Task 3 存储契约测试通过 |
| `a82346545b7fe2e9914df8dc21f0a6612b9f51bf` | fix(storage): 隔离失败本地缓存写入 | Task 3 专项通过 |
| `51c436418697f8e299eef7a7d0d1c6a31418e204` | fix(storage): 重启后不信任缓存 | Task 3 专项通过 |
| `7327bd938d06a594e3804a9b36697263682f6187` | fix(storage): 物化持久 Artifact 路径 | Task 3 专项通过 |
| `5a394ca7ce4311723f6b695b99ac575dbe3f1dc7` | fix(storage): 加固持久清理边界 | Task 3 专项 4 文件 / 70 测试通过 |
| `5dbc9f7cad73cb74a71f436f55149c58bec2dc5b` | feat(artifacts): hash-gated R2 下载 | Task 4：聚焦 4 文件 / 49 测试通过 |
| `0fb0ba90d6eee626e8da52a488aa491f9239886c` | feat(backup): PostgreSQL 归档落 R2 | Task 5：聚焦 3 文件 / 34 测试通过（修复后） |
| `fd234b269560e2c9eb70c0cad84e8371f27dd843` | fix(backup): 调度常驻与轮转卫生 | Task 5 复审 APPROVE（0 Critical / 0 Important） |

## 3. 明确拒绝范围

- **GHCR 发布**：registry 发布、可变 `dev` tag、registry 登录与 packages 写权限；
- **自托管反向代理**：Basic Auth / CIDR 白名单 / 反代认证拓扑；
- **本地多容器编排栈**：生产不再使用本地编排栈或预构建不可变镜像 tag；
- **旧 Worker 运行时**：共享 root env 注入 Worker、Worker 直连 provider、
  旧 provider bootstrap；
- **donor 迁移导入**：predev 迁移谱系保持到 `0031`；不 import、重写、squash 或
  重编号 `zeabur/deploy` 的迁移；
- **Node 24**：本次集成锁定 Node 22（Node 24 升级是独立变更）。

## 4. 实际执行的命令与证据

- Task 4：隔离 PostgreSQL 套件 54 文件 / 312 测试通过（含
  `src/features/artifacts/service.pg.test.ts`）；聚焦 Artifact 测试 4 文件 /
  49 测试通过；`verify:v3` 通过；`git diff --check` 干净。
- Task 5：聚焦备份套件 3 文件 / 34 测试通过（含修复后全量）；真实恢复演练（隔离环境、合成
  测试凭据，postgres:17.5-alpine + MinIO）结果：

  ```json
  {"status":"ok","key":"backups/drill-d9a254e8/2026-08-02T20-22-16-879Z-purpleink.dump","users":2,"migrations":1}
  ```

  演练容器、网络与镜像已清理；未触碰 Zeabur、R2 或生产凭据。

## 5. 未决事项（2026-08-03 全部解决，见 §6）

- ~~Task 6 / Task 7 / Task 8 尚未完成~~ → 已全部完成（§6）；
- ~~5 个 typecheck 错误（Task 7 的两个 marketing RED 测试）~~ → Task 7 已解决，最终 typecheck 0 错误；
- ~~Docker 构建 web / worker / migrate 待验证~~ → 四个镜像已构建并验证（§6）；
- ~~provenance merge 待执行~~ → 已执行且 tree 不变（§6）；
- ~~Task 8 最终全量门禁与合并前 tree 记录~~ → 已执行（§6）。

## 6. Task 8 最终验收（2026-08-03）

### 6.1 来源 SHA（fetch 后实测）

| 分支 | 完整 SHA | 状态 |
| --- | --- | --- |
| `origin/predev` | `ad5d25684e3d21fb05437fd5c31da280e211b12a` | 与计划锁定一致 |
| `origin/zeabur/deploy` | `cef193e70857689c034036c4c8f2684d26545854` | 偏离计划锁定 `fffd93698fa6553a42409e8a45517bf88aac9cb5`，已审计（§6.2） |
| merge 前 HEAD | `cdbf12a2499e17ef66598df9581617cbf6ff9e0a` | `HEAD^{tree}=feb0d05d002ba89d1b70b0bcd109e401709f5e4b` |
| merge 后 HEAD | `f7e7217ec340954b3aaa996132972f67a415f8ae` | `HEAD^{tree}=feb0d05d002ba89d1b70b0bcd109e401709f5e4b`（与合并前**完全一致**） |

### 6.2 计划锁定后的 donor 新增提交审计（结论：只记祖先，不采纳）

`fffd936…` 是 `cef193e…` 的**直接祖先**，中间恰有两笔线性提交：

1. `e551888997220b550e697ad09791a688f7259b0f` fix(migrate): include workflow schema dependency
   —— 为 donor 的 `Dockerfile.migrate` 补 `COPY src/lib/workflow`。**拒绝理由**：我们的 migrate 闭包
   自足（schema 全部在 `src/lib/db/schema/` 内，`db-migrate.ts` 仅依赖 `src/lib/db/migrate`），
   Task 8 实测镜像构建与 `0031` 闭包检查通过，无需该补丁。
2. `cef193e70857689c034036c4c8f2684d26545854` fix(engine): proxy worker from runtime environment
   —— 用 `src/features/engine/runtime-proxy.ts` + `/api/engine/[[...path]]` 路由替换 `next.config.ts`
   rewrites。**拒绝理由**：计划锁定后的架构变更，与锁定契约（Web 经
   `http://worker.zeabur.internal:8787` 调用 Worker）不冲突但非必需；采纳会改动 predev 的引擎
   调用面并扩大范围。本集成继续使用 predev 的 next.config rewrites 方案（构建期注入
   `BACKEND_ORIGIN`）。

### 6.3 最终门禁（merge 后新鲜运行，全部通过）

| 命令 | 结果 |
| --- | --- |
| `rtk pnpm lint` | PASS |
| `rtk pnpm typecheck` | PASS（0 errors） |
| `rtk pnpm --filter purpleink-server typecheck` | PASS |
| `rtk pnpm --filter @purpleink/procedural-sfx typecheck` | PASS |
| `rtk pnpm test` | 283 文件 / 1883 测试 PASS |
| `rtk pnpm test:pg:isolated` | 54 文件 / 312 测试 PASS（PostgreSQL 17.5 一次性容器） |
| `rtk pnpm verify:v3` | `ok: true`，`violations: []` |
| `rtk pnpm verify:workflow` | `ok: true`，blocking 0（fresh 迁移库） |
| `rtk pnpm build` | PASS |
| `rtk pnpm exec vitest run tests/deployment-config.test.ts tests/pg-backup-contract.test.ts` | 2 文件 / 30 测试 PASS |
| `rtk git diff --check` | 干净 |

### 6.4 四个 Docker 镜像构建与边界验证

| 镜像 | 构建 | 验证 |
| --- | --- | --- |
| `Dockerfile.web`（`NEXT_PUBLIC_SITE_URL` 以 ARG/ENV 在 `pnpm build` 前注入） | PASS | 非 root（uid 999）；运行时 env 无 DATABASE/S3_*/CVC_MANAGED*/CVC_MAIL*/计费/价格/R2 密钥 |
| `Dockerfile.worker` | PASS | 非 root（uid 999）；ffmpeg 5.1.9 / ffprobe / Chromium + headless_shell 在位；env 无 DATABASE/POSTGRES/S3_/R2_/PROVIDER/BILLING/PRICE/CVC_MANAGED/CVC_MAIL |
| `Dockerfile.migrate` | PASS | 闭包只含 tsconfig/db-migrate/migrate/schema/migrations；`0031_tiny_spencer_smythe.sql` 为最后迁移 |
| `Dockerfile.backup` | PASS | `pg_dump (PostgreSQL) 17.10`、Node 22.23.2、scripts/backup 在位 |

真实恢复演练（merge 后 fresh 重跑）：

```json
{"status":"ok","key":"backups/drill-4fe6d0f2/2026-08-02T21-16-48-522Z-purpleink.dump","users":2,"migrations":1}
```

### 6.5 provenance merge

- 执行：`rtk git merge -s ours --no-ff origin/zeabur/deploy`
- `HEAD^1^{tree}` = `feb0d05d002ba89d1b70b0bcd109e401709f5e4b`
- `HEAD^{tree}` = `feb0d05d002ba89d1b70b0bcd109e401709f5e4b`
- 结论：**完全一致**，merge 未改变已验证文件树；zeabur/deploy 仅记录为祖先。

### 6.6 非阻塞风险（如实记录）

- Task 5：`finally rm` 失败路径无测试覆盖（A1）；list 前缀归一化无直接断言（A2）——实现正确，测试为 Minor 缺口。
- Task 6：历史/计划文档仍引用已删除的 `docs/deployment/access.md`（仅限历史文档，活动文档已清零）。
- Task 7：`image-reveal.test.ts` 用边界断言而非精确元组（preflight 允许）；FAQ id 为静态索引派生；移动端菜单按钮可访问名重复声明（既有代码）。
- 未执行：push、PR、生产部署；无生产凭据被读取或写入。

### 6.7 建议的后续命令（未执行）

```bash
rtk git push -u origin zeabur/predev-integration
rtk gh pr create --base predev --head zeabur/predev-integration --title "zeabur/predev-integration: Zeabur production integration" --body "See docs/integration/zeabur-predev-integration-2026-08-02.md"
```
