# PurpleInk + CodeVideoCanvas Stage A 迁移报告

> 执行分支：`feature/merge-cvc`
> 基线标签：`pre-merge-baseline`
> 目标仓库：`D:\projects\Dev-Tools\PurpleInk-dev`
> 只读来源：`D:\projects\Dev-Tools\CodeVideoCanvas`

## 执行原则

- 本报告只记录真实执行结果；失败项不会改写为成功。
- 未接线页面必须显式标注，不使用假数据、假进度或恒真状态。
- 敏感配置只记录变量名，不记录或提交其值。
- 来源仓库只读；最终以迁移前后的 Git 状态一致性自证未写入。

## M0 安全网与基线

执行时间：2026-07-25

### 仓库基线

| 项目 | 实际结果 |
| --- | --- |
| 初始 Git 状态 | 目标目录不是 Git 仓库 |
| 基线提交 | `1d41aa5 chore: baseline before cvc merge` |
| 基线标签 | `pre-merge-baseline` |
| 工作分支 | `feature/merge-cvc` |
| 来源仓库初始 HEAD | `0fd1800d4052ff824ca0a14402d3e6bd14116160` |
| 来源仓库初始状态 | 原有 1 个已修改文件和 4 组未跟踪路径；详见 M7 前后状态核对 |

### 工具版本

| 命令 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `node --version` | 0 | `v24.15.0` |
| `npm --version` | 0 | `11.12.1` |
| `pnpm --version` | 0 | `10.30.0` |
| `docker version` | 0 | Client `29.4.3`；Docker Desktop `4.73.0`；Engine `29.4.3` |

### PurpleInk 基线门禁

| 工作目录 | 命令 | 退出码 | 结果 |
| --- | --- | ---: | --- |
| 根目录 | `npm run typecheck` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`tsc` 不可用 |
| 根目录 | `npm run build` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`next` 不可用 |
| 根目录 | `npm run lint` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`eslint` 不可用 |
| `server/` | `npm run typecheck` | 1 | `KNOWN-BASELINE-FAIL`：依赖尚未安装，`tsc` 不可用 |

这些失败由目标目录初始状态缺少 `node_modules` 导致。M0 按阶段边界不安装依赖、不修改源码，
因此将其作为已知基线失败继续；后续门禁必须在统一依赖安装后重新执行，不能把这里的失败
算作合并引入的回归。

## M1 目录形态改造

待执行。

## M2 包与工具链统一

待执行。

## M3 CVC 视觉层与基础库

待执行。

## M4 CVC 数据层与业务后端

待执行。

## M5 路由并存

待执行。

## M6 统一路由骨架

待执行。

## M7 收口与交接

待执行。
