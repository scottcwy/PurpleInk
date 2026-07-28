import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * workspace 归属的单一读取口契约（PLAN-002 §1.2 / §10 禁区 5）。
 *
 * `LOCAL_WORKSPACE_ID` 已降级为「历史迁移 / bootstrap / 进程级配置锚点」专用，
 * 业务层（src/features、src/app）不得再 import 它做查询条件——遗漏会造成
 * 跨账户静默串号。白名单里的文件是明确豁免并写明理由的存放点。
 */
const SRC_ROOT = join(__dirname, '..', 'src')

/** 允许出现 LOCAL_WORKSPACE_ID 的生产文件（相对 src/，POSIX 分隔符）。 */
const ALLOWLIST = new Set([
  // 常量定义与聚合导出。
  'lib/db/client.ts',
  'lib/db/index.ts',
  // 进程级配置行的存放锚点（laneQuotas 语义为进程级，见该文件头注释）。
  'lib/queue/runtime-config.ts',
  // 文档注释里解释禁令本身。
  'lib/auth/workspace-context.ts',
  // 历史数据归属认领（仅迁移脚本与 pg 测试消费，不进请求路径）。
  'features/auth/claim-workspace.ts',
])

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out)
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    // 测试文件可以自由 seed 固定 workspace，不在禁令范围内。
    if (/\.(test|pg\.test)\.tsx?$/.test(entry)) continue
    out.push(full)
  }
  return out
}

describe('workspace 上下文契约', () => {
  it('业务生产代码不再引用 LOCAL_WORKSPACE_ID（白名单之外零命中）', () => {
    const offenders: string[] = []
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const relative = file
        .slice(SRC_ROOT.length + 1)
        .split('\\')
        .join('/')
      if (ALLOWLIST.has(relative)) continue
      if (readFileSync(file, 'utf8').includes('LOCAL_WORKSPACE_ID')) {
        offenders.push(relative)
      }
    }
    expect(offenders).toEqual([])
  })
})
