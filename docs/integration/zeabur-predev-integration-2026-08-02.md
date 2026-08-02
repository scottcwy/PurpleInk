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

## 5. 未决事项（未声称已通过）

- Task 6（本文档同期交付）、Task 7、Task 8 尚未完成；
- 5 个 typecheck 错误来自 Task 7 的两个 marketing RED 测试
  （`src/components/marketing/image-reveal.test.ts`、
  `src/components/marketing/marketing-ux-contract.test.ts`），由 Task 7 解决；
- Docker 构建 web / worker / migrate 待 Task 8 验证；
- provenance merge 待 Task 8 执行（计划锁定 `fffd936…`；当前
  `origin/zeabur/deploy` 分叉需先审计）；
- Task 8 最终全量门禁与合并前 tree 记录待执行。
