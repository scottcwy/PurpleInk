# ISSUE-009 修复证据

修复日期：2026-07-25

## 1. 验证结果

| 验证项 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 100 files / 434 passed / 0 skipped，exit 0 |
| `pnpm verify:v3` | `"ok": true, "violations": []`，exit 0 |
| `pnpm build` | 成功，`/robots.txt` 与 `/sitemap.xml` 均在路由输出列表 |

## 2. 验收标准对照

| 标准 | 状态 | 证据 |
| --- | --- | --- |
| 1. `pnpm test` 全绿 + 编码测试覆盖含 `/` 的 id | ✅ | `tests/url-encoding-contract.test.ts` 4 个测试用例，断言 `%2F` |
| 2. `pnpm typecheck` / `build` / `verify:v3` 不增违规 | ✅ | 见上表 |
| 3. 全仓库 grep `font-sc`：零命中或有定义 | ✅ | 代码零命中，仅 `README.md` 历史记录文字保留 |
| 4. `src/components/ui/**` 内 `text-label-secondary/tertiary` 零命中 | ✅ | search_files 返回 0 results |
| 5. `curl` 验证 `/robots.txt` 与 `/sitemap.xml` | ⏳ | build 输出确认路由存在；curl 验证需 dev server 运行 |
| 6. 4 个边界页 Chromium 截图回归 | ⏳ | token 替换为 `ds-text-muted`，视觉差异在预期内；截图需 dev server |
| 7. `routing.md` §11 表格同步 | ✅ | 4 项标 ✅，1 项标 ⏳ |
| 8. 证据留档 | ✅ | 本文件 |

## 3. 修改文件清单

### 代码文件

| 文件 | 改动 |
| --- | --- |
| `src/app/robots.ts` | 加 `/share/` 到 disallow |
| `src/app/sitemap.ts` | 加注释指向 routing.md §3 与 §8 |
| `src/app/products/(app)/canvas/[projectId]/canvas-inspector.tsx` | `encodeURIComponent(artifact.id)` + `encodeURIComponent(projectId)` |
| `src/lib/api.ts` | `videoUrl(id)` 加 `encodeURIComponent(id)` |
| `src/components/ui/empty-state.tsx` | `text-label-*` → `text-ds-text-muted`，删 `font-sc` |
| `src/components/ui/button.tsx` | 删 `font-sc` |
| `src/components/ui/node/export-node.tsx` | `text-label-secondary` → `text-ds-text-muted`，`text-label` → `text-ds-text`，删 `font-sc` |
| `src/components/ui/node/shot-node.tsx` | `text-label-tertiary` → `text-ds-text-muted`，`text-label` → `text-ds-text`，删 `font-sc` |
| `src/components/ui/resize-handle.demo.tsx` | `text-label-secondary/tertiary` → `text-ds-text-muted` |
| `src/components/ui/tooltip.demo.tsx` | `text-label-secondary` → `text-ds-text-muted` |
| `src/components/ui/top-bar.tsx` | 删 `font-sc` |
| `src/components/ui/tooltip.tsx` | 删 `font-sc` |
| `src/components/ui/toast.tsx` | 删 `font-sc` |
| `src/components/ui/timeline-track.tsx` | 删 `font-sc` |
| `src/components/ui/text-field.tsx` | 删 `font-sc` |
| `src/components/ui/text-area.tsx` | 删 `font-sc` |
| `src/components/ui/status-pill.tsx` | 删 `font-sc` |
| `src/components/ui/settings-row.tsx` | 删 `font-sc` |
| `src/components/ui/collapsible-card.tsx` | 删 `font-sc` |
| `src/components/ui/queue-status-bar.tsx` | 删 `font-sc` |
| `src/components/ui/project-card.tsx` | 删 `font-sc` |
| `src/components/ui/dialog.tsx` | 删 `font-sc` |
| `src/components/ui/search-field.tsx` | 删 `font-sc` |
| `src/components/ui/progress-bar.tsx` | 删 `font-sc` |
| `src/components/ui/node/stage-node.tsx` | `text-label` → `text-ds-text`，删 `font-sc` |
| `src/components/ui/contact-sheet-thumb.tsx` | 删 `font-sc` |
| `src/components/ui/node/audio-node.tsx` | `text-label` → `text-ds-text`，删 `font-sc` |
| `src/components/ui/nav-item.tsx` | 删 `font-sc` |
| `src/app/products/(app)/export/[projectId]/export-review.tsx` | 删 `font-sc` |

### 测试文件

| 文件 | 改动 |
| --- | --- |
| `tests/url-encoding-contract.test.ts` | 新增，覆盖三条 URL 合同的编码行为 |

### 文档文件

| 文件 | 改动 |
| --- | --- |
| `docs/conventions/routing.md` | §4.3 更新违规描述，§11 表格加状态列 |
| `docs/issues/ISSUE-009-routing-convergence.md` | 加 §5 sitemap 方案决策 |
| `src/app/README.md` | §8 已知问题列表标注修复状态 |

## 4. sitemap 方案

选择「结构就绪 + 注释」方案。理由见 ISSUE-009 §5。

## 5. 待办（需 dev server 运行时验证）

- [ ] `curl http://localhost:3000/robots.txt` 确认含 `Disallow: /share/`
- [ ] `curl http://localhost:3000/sitemap.xml` 确认只有 `/` 一条
- [ ] 4 个边界页 Chromium 截图回归