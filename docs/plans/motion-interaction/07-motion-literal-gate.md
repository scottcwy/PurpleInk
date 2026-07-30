# 07 · `MOTION_LITERAL` 门禁

- 前置：03 与 04 完成（门禁用 baseline 冻结存量，现在冻结等于把待修的债合法化）
- 消掉意图：无
- 共用硬边界与验证清单见 `00-README.md` §0

## 1. 目标与非目标

**目标**：让"绕过 token 直接写死数值"这件事在 CI 层面不可能新增。

**非目标**：不要求存量为零。存量由 baseline 冻结（只能降不能升），
新增即失败。这与仓库既有的三个债务类别是同一机制，不引入新概念。

## 2. 为什么仍然需要门禁

规划期有一个反例值得记录：并行工作提交的 `ContextMenu`（`b8717e1`）
**完全合规**——从 `@/lib/motion/tokens` 取 `SPRING_SPATIAL_FAST` / `DURATION.fast` /
`TRANSITION_EXIT`，hover 用 `duration-fast ease-standard`，零字面量，
提交信息还直接引用了规范条目。

这证明"读规范"这条路径可行，门禁的紧迫度低于原估。但这是**一次样本**：
它成立的前提是执行者读了规范。门禁的作用不是替代规范，而是在没读的那一次兜住。

## 3. 现有机制的扩展点（已核实）

| 位置 | 内容 |
| --- | --- |
| `scripts/verify/v3-architecture.ts` | `DEBT_CATEGORIES`（约第 13 行）现有三项：`directOpenAiClientImports`、`canvasForbiddenImports`、`triggerTaskForbiddenImports` |
| 同文件 | `SCAN_DIRECTORIES = ['docs','packages','scripts','src','trigger']`；`CODE_EXTENSIONS` 含 `.ts/.tsx/.js/.mjs` 等 |
| `scripts/verify/v3-architecture-baseline.json` | baseline 文件 |
| `src/lib/architecture/v3-architecture.test.ts` | 该模块的单测，新规则要在这里补用例 |
| `package.json` | `verify:v3`（`--check`）、`report:v3`（`--report`）；写 baseline 是 `--write-baseline <path>` |

### 3.1 ⚠️ 一个必须先处理的陷阱

`readBaseline` 会校验 **每一个** `DEBT_CATEGORIES` 成员都存在于 `baseline.debtCaps`，
否则抛「architecture baseline 无效」。而 `writeV3ArchitectureBaseline` 在目标文件
**已存在时直接抛错**（write-once 设计）。

后果：**新增一个 debt category 会让现有 baseline 立即失效，且不能原地覆盖。**
必须删除旧 baseline 再 `--write-baseline` 重新生成，而重新生成会把**其它三个类别的
cap 一并重置为当前实际值**。如果期间某个类别的债增长过，这一步会把增长静默合法化。

**执行要求**：重新生成 baseline 之前，先 `pnpm report:v3` 记录三个既有类别的当前数量，
与旧 baseline 的 cap 逐一对比。若有增长，**先修增长再生成 baseline**，
并在提交信息里列出四个类别的 before / after 数字。不允许无声重置。

## 4. 检测规则

新增类别名建议 `motionLiterals`，规则 id `MOTION_LITERAL`。检测目标（规范 §5.1）：

| # | 模式 | 说明 |
| --- | --- | --- |
| 1 | `duration-<数字>` | 非档位时长（`duration-150` / `200` / `300` …） |
| 2 | `cubic-bezier(` | 手写曲线（`globals.css` 的 token 定义本身除外，见 §4.1） |
| 3 | `transition-<属性>` 后无 `duration-` | 隐式吃 Tailwind 默认值，等于第五个隐式档 |
| 4 | `transition-all` | 规范 §5.1 明令禁止 |
| 5 | `ease-[` | 内联曲线 |

### 4.1 必须排除的范围

- `src/app/globals.css` / `design-system.css` —— token 定义本身
  （但 `CODE_EXTENSIONS` 不含 `.css`，默认已排除，确认即可）；
- `docs/**` —— `SCAN_DIRECTORIES` **包含 docs**。规范文档必然出现
  `duration-150`、`cubic-bezier` 这类字面量作为反面示例，若不排除会自我报警。
  **这是本批次最容易踩的坑**；
- `**/*.test.ts` / `*.demo.tsx` —— 参照现有 `productionHardLimit()` 的豁免思路；
- `src/features/render/__fixtures__/**` —— 渲染侧 fixture，不受应用 UI 规范约束。

### 4.2 规则 3 的实现难点

"`transition-*` 后无 `duration-`" 需要看**同一个 className 字符串内**是否同时出现，
而 className 常由 `cn()` 拼接、跨多行、含条件表达式。逐行正则会大量误报。

**建议实现**：以 AST 为单位——该文件已 `import ts from 'typescript'`，
现有规则就是走 TS AST 的。对每个字符串字面量/模板字面量节点判断，
而不是对文本行判断。若 AST 方案成本过高，**允许先只上规则 1 / 2 / 4 / 5**
（纯词法可判定），把规则 3 记为待补并写进本文档，不要用高误报的正则凑数。

一个总是误报的门禁比没有门禁更糟——它会训练执行者习惯性忽略。

## 5. 执行步骤

1. `pnpm report:v3` 记录四类现状（三个既有 + 新规则的扫描结果）。
2. 实现规则（优先 1/2/4/5，规则 3 按 §4.2 判断）。
3. 在 `src/lib/architecture/v3-architecture.test.ts` 补用例：命中、豁免、
   `DEBT_CAP_EXCEEDED` 触发各一组。
4. 按 §3.1 的要求处理 baseline 重建（先对比、再删除、再生成）。
5. `pnpm verify:v3` 必须 exit 0。
6. **反向验证**：临时在某个生产文件写一个 `duration-250`，确认 `verify:v3` 变红，
   然后还原。不做这一步就不知道门禁是否真的在工作。
7. 在 `motion-interaction.md` §5.1 补一句门禁已落地及类别名；§7.1 状态列加一行。

## 6. 验证

- `pnpm verify:v3` exit 0，`violations` 为空；
- 反向验证能红；
- 新增用例通过，且既有 `v3-architecture.test.ts` 全绿；
- 提交信息含四个类别的 before / after cap；
- 共用清单全套。

## 7. 风险与回滚

**风险 1**：baseline 重建把其它类别的债静默放宽。由 §3.1 的对比步骤防住，
这是本批次**最需要小心**的一点。

**风险 2**：误报导致门禁不可用。缓解见 §4.2——宁可少一条规则，
不要一条高误报规则。

**风险 3**：`docs/**` 未排除导致规范文档自己触发门禁。§4.1 已点明。
本轮已有类似前车之鉴：文档里的 `duration-[var(...)]` 被 Tailwind 扫成候选类
生成非法 CSS，同样是"文档内容意外进入构建/检查管线"。

**回滚**：单提交 revert，但需要连带恢复旧 baseline 文件。
建议 baseline 与规则实现放**同一个提交**，避免 revert 后出现规则与 baseline 不匹配。

## 8. 完成判据

- [ ] `motionLiterals` 类别已加入 `DEBT_CATEGORIES`，规则 id 为 `MOTION_LITERAL`；
- [ ] `docs/**`、`*.test.*`、`*.demo.*`、渲染 fixture 已豁免；
- [ ] baseline 已按 §3.1 流程重建，四类 before / after 已记录在提交信息；
- [ ] 反向验证通过（人为字面量能让 `verify:v3` 变红）；
- [ ] 规则 3 已实现，或已记录为待补并说明理由；
- [ ] `motion-interaction.md` §5.1 / §7.1 已回写；
- [ ] 单个 Conventional Commit（规则 + 测试 + baseline 同批）。
