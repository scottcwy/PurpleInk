# ISSUE-010 浏览器与门禁证据

## 验收数据

- 日期：2026-07-25
- 数据源：本地开发 Postgres（真实 `projects` / `canvas_nodes` 投影）
- 项目：`ISSUE-010 Acceptance`
- projectId：`41e32ec8-d721-40c8-a8ca-23763ec1d12e`
- shotId：`aac1715a-7c89-56c2-9a9c-7b91aa72567f`
- laneKey：`S001`
- Chromium viewport：`1440 × 1000`

项目通过现有 `POST /api/projects` 创建，分镜通道通过现有
`materializeShotLanes` 领域能力写入本地 Postgres。页面未注入 mock 或 fixture 数据。

## 拆分前门禁

`pnpm verify:v3` exit 1，且只有两条违规：

- `export-workspace.tsx`：389 行，`OVERSIZED_NEW_FILE`
- `shot-detail.tsx`：525 行，`OVERSIZED_NEW_FILE`

同时确认：

- `directOpenAiClientImports`：3；
- `replacementCharacters`：0。

## 拆分前浏览器

### 分镜详情

- URL：`/products/shots/aac1715a-7c89-56c2-9a9c-7b91aa72567f?projectId=41e32ec8-d721-40c8-a8ca-23763ec1d12e`
- 截图：`shot-before.png`
- 页面标题：`PurpleInk`
- Console errors：0
- 页面与 RSC 请求：HTTP 200

### 导出工作区

- URL：`/products/export/41e32ec8-d721-40c8-a8ca-23763ec1d12e`
- 截图：`export-before.png`
- 页面标题：`PurpleInk`
- Console errors：0
- `GET /api/render/export`：HTTP 200

## 受控视觉比较

拆分前后截图均在临时 detached worktree 中生成，以隔离主工作区同期发生的共享 UI
字体 class 修改：

- before commit：`b1a1669`
- after commit：`978d463`
- 数据库、URL、Chromium session 与 viewport 完全相同

### 分镜详情

- `shot-before.png`：1440×1000
- `shot-after.png`：1440×1000
- 两文件 SHA-256：
  `3762FA60E3A72868072B9C2E7FE64FCAADC6802CED0715DE8D72C04ED4EFCADB`
- Console errors：0

### 导出工作区

- `export-before.png`：1440×1000
- `export-after.png`：1440×1000
- 两文件 SHA-256：
  `279A518A301E3B2A2D19A7F1353DD1D4DCA88FE60846205066FD43CA76C65526`
- Console errors：0
- `GET /api/render/export`：HTTP 200

两组截图均为逐字节相同，不只是尺寸或人工观察一致。

## 最终文件规模

| 文件 | 行数 |
| --- | ---: |
| `shot-detail.tsx` | 144 |
| `use-shot-runtime.ts` | 73 |
| `shot-player.tsx` | 188 |
| `shot-detail-panels.tsx` | 109 |
| `export-workspace.tsx` | 107 |
| `use-export-runtime.ts` | 52 |
| `export-review.tsx` | 234 |
| `export-view-model.ts` | 50 |

所有入口与新增生产文件均不超过 250 行。

## 最终门禁

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 100 files / 434 tests passed，exit 0 |
| `pnpm verify:v3` | `ok: true`、`violations: []`，exit 0 |
| `pnpm build` | 编译、类型检查、静态生成完成，exit 0 |
| `git diff --check` | exit 0 |
| U+FFFD 扫描 | 0 matches |

第一次将全量测试与其他门禁并行执行时，queue/Director 初始化的 2 个测试因超时失败；
两项定向重跑 6/6 通过，随后独占重跑全量测试 434/434 通过，判定为并行资源争用，
不是 ISSUE-010 回归。

`pnpm build` 在成功结束后打印 3 条 pi-agent 动态模块解析的非致命诊断
（`Cannot find module as expression is too dynamic`）。命令仍为 exit 0；该诊断由同期
Director 运行时接线引入，不属于本 issue 的文件或行为范围。
