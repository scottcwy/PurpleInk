# ISSUE-009 · routing.md §11 收敛清单未清（编码、robots、sitemap、token）

- 优先级：**P2**（其中「编码」一项是安全/正确性问题，实际应尽早做）
- 状态：`open`
- 范围：5 个已登记的收敛点，文件互不重叠
- 依赖：无。**可第一批并行**，与 P0 三条零重叠
- 性质：清单式修复，无需决策

## 1. 背景

`docs/conventions/routing.md` §11 已经登记了一张「收敛清单」，条目至今未清。
本 issue 把它变成可执行任务。每条都可独立提交。

## 2. 清单

### 2.1 artifact href 未编码 `projectId`（正确性 + 安全）

**位置**：`src/app/products/(app)/canvas/[projectId]/canvas-inspector.tsx`

routing.md §4.3 规定：

> 三条 URL 的所有 path 与 query 片段都必须 `encodeURIComponent`。
> 已知违规：`canvas-inspector.tsx` 拼 artifact href 时未编码 `projectId`，需修。

资源 URL 合同是 `/api/artifacts/{artifactId}?projectId={projectId}`。

**要求**：
- `artifactId` 与 `projectId` 双方都 `encodeURIComponent`；
- 补测试覆盖**含 `/` 的 id**（routing.md §5 第 5 条要求，现有测试用 `%2F` 断言，保留该风格）；
- 顺带核查另外两条 URL 合同的生产方是否也有同类漏洞：
  `src/lib/hooks/use-stage-stream.ts`（阶段日志流）、`src/lib/api.ts`（worker 视频）。

### 2.2 `robots.ts` 缺 `/share/` disallow

**位置**：`src/app/robots.ts`（15 行）

routing.md §8.5 与 §3 规定 `/share/*` 必须 `noindex, nofollow` 并加入 disallow。
当前只有 `disallow: /api/`、`/private/`。

**注意**：`/share/[shareId]` 路由本身状态是 `planned`（尚未落盘）。
先加 disallow 是正确的——它是防御性配置，不依赖路由存在。

### 2.3 `sitemap.ts` 只有一条

**位置**：`src/app/sitemap.ts`（13 行）

routing.md §3 规定 `/artifacts` 与每个 `featured` 案例必须进 sitemap。

**注意**：`/artifacts` 与 `ShareSnapshot` 都是 `planned` 状态，数据源不存在。
因此本条**只能做到「结构就绪」**：不得为了填 sitemap 而编造条目或硬编码假案例。
可接受的交付是：
- 保持现状 + 在 `sitemap.ts` 加注释指向 routing.md §8，说明待 `ShareSnapshot` 落盘后接入；
- 或把本条标为 `blocked`，依赖未来的 `/artifacts` issue。
**选哪种都要在本文件写明。**

### 2.4 `empty-state.tsx` 历史 token 未收敛

**位置**：`src/components/ui/empty-state.tsx`（30 行）

routing.md §11 与 `docs/designs/Design-system-inventory.md` §4 要求
新 Canonical 组件只用 `ds-*` token，而该文件仍在用
`text-label-secondary` / `text-label-tertiary` 等历史 token。

**要求**：换成 `ds-*` 对应 token。**必须以 `docs/designs/canvas.pen` 与
`Design-system-inventory.md` 的映射为依据**，不得凭视觉近似自行挑一个。
该组件被 `route-status.tsx` 复用（4 个错误/未找到边界页共用），改动面需回归截图。

### 2.5 `font-sc` 是空类名

**位置**：`src/components/ui/button.tsx`、`src/components/ui/empty-state.tsx`

routing.md §11：

> `font-sc` class 全仓库未定义，`button.tsx`、`empty-state.tsx` 仍在挂 —— 空类名，应删或补定义。

**要求**：先 grep 确认 `globals.css` / Tailwind 配置里确实没有定义，
然后二选一并说明理由（倾向**删除**，除非设计稿要求中文字重变体）。

## 3. 修复范围汇总

| 文件 | 条目 |
| --- | --- |
| `src/app/products/(app)/canvas/[projectId]/canvas-inspector.tsx` | 2.1 |
| `src/lib/hooks/use-stage-stream.ts`、`src/lib/api.ts` | 2.1 核查 |
| `src/app/robots.ts` | 2.2 |
| `src/app/sitemap.ts` | 2.3 |
| `src/components/ui/empty-state.tsx` | 2.4、2.5 |
| `src/components/ui/button.tsx` | 2.5 |
| `docs/conventions/routing.md` | 清单条目状态同步 |

对应测试：`canvas-inspector` 需要新增编码测试；
`src/components/ui/canonical-components.test.ts` 与 `tests/cvc-ui-smoke.test.tsx` 需回归。

## 4. 禁区

1. **不得为了填 sitemap 而编造 featured 案例或假 slug**（AGENTS.md §6 禁止假数据）。
2. 不改 `EmptyState` 的 API 或视觉结构，只换 token。
3. 不在 `robots.ts` 里 disallow `/products/`——它是认证后路由，
   routing.md §1 表格里 `/products/*` 的可索引性是「否」，
   但当前 robots 是 `allow: /`；是否补 disallow 需按 routing.md §3 的明文规则来，
   **本 issue 不擅自扩大范围**，若发现规则缺失则先提出而不是自行决定。
4. 不动 `server/**`。
5. 改 `routing.md` 时遵循「先改真值文件再改代码」的顺序。

## 5. 验收标准

1. `pnpm test` 全绿；新增的编码测试覆盖含 `/` 的 id 并断言 `%2F`。
2. `pnpm typecheck` exit 0；`pnpm build` 成功；`pnpm verify:v3` 违规数不增加。
3. 全仓库 grep `font-sc`：零命中，或有明确定义。
4. 全仓库 grep `text-label-secondary`、`text-label-tertiary`：
   在 `src/components/ui/**` 内零命中（其他历史区域不在本 issue 范围）。
5. `curl` 或浏览器验证 `/robots.txt` 与 `/sitemap.xml` 的真实响应内容，留档。
6. 4 个边界页（`not-found.tsx` ×2、`error.tsx`、`global-error.tsx`）真实 Chromium 截图，
   确认 token 替换后视觉未回退、控制台无报错。
7. `docs/conventions/routing.md` §11 表格中已完成条目已移除或标注完成；
   `sitemap` 一项若为 `blocked` 则在本文件与 routing.md 同步写明依赖。
8. 证据留档到 `docs/issues/evidence/issue-009/`。
