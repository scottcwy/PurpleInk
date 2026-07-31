/**
 * 既有数据归属迁移（PLAN-002 §5.5）：把历史单工作区 `LOCAL_WORKSPACE_ID`
 * 交给一个已注册用户（建立 `workspace_members(owner)` 关系）。
 *
 * 不搬数据、不改任何行的 workspaceId——只补成员关系，最小且可逆。
 * 幂等：连续执行第二次原地退出，不产生第二条成员关系。
 *
 * 用法（需要 DATABASE_URL 指向目标库）：
 *   pnpm tsx scripts/migration/claim-local-workspace.ts --email you@example.com
 */
import { createRequire } from 'node:module'
import { loadEnvConfig } from '@next/env'

// `src/lib/db/client.ts` 用 `import 'server-only'` 作为 Next 进程哨兵；
// 本脚本在 Next runtime 之外跑，使用 server-only shim。
const nodeRequire = createRequire(import.meta.url)

function installServerOnlyShim(): void {
  const stubPath = nodeRequire.resolve('../setup/server-only-stub.js')
  const Module = nodeRequire('node:module') as typeof import('node:module')
  const holder = Module as unknown as {
    _resolveFilename: (...args: unknown[]) => string
  }
  const original = holder._resolveFilename
  holder._resolveFilename = function (
    request: unknown,
    ...rest: unknown[]
  ): string {
    if (request === 'server-only') return stubPath
    return original.call(this, request, ...rest)
  }
}

installServerOnlyShim()
loadEnvConfig(process.cwd())

function parseEmail(argv: readonly string[]): string {
  const index = argv.indexOf('--email')
  const email = index >= 0 ? argv[index + 1] : undefined
  if (!email || !email.includes('@')) {
    throw new Error('用法：claim-local-workspace --email <已注册用户邮箱>')
  }
  return email
}

async function main(): Promise<void> {
  const email = parseEmail(process.argv.slice(2))
  const { LOCAL_WORKSPACE_ID } = await import('@/lib/db/client')
  const { claimWorkspaceForUser } = await import('@/features/auth/claim-workspace')

  const result = await claimWorkspaceForUser({
    workspaceId: LOCAL_WORKSPACE_ID,
    email,
  })
  if (!result.ok) {
    if (result.reason === 'workspace-not-found') {
      // 没有历史单工作区行 = 库里没有需要认领的旧数据，什么都不用做。
      console.log('[claim] 历史 workspace 不存在，无旧数据可认领，跳过')
      return
    }
    throw new Error('[claim] 该邮箱未注册，请先在 /signup 完成注册')
  }
  console.log(
    result.created
      ? '[claim] 已建立 owner 成员关系，历史数据归属该账号'
      : '[claim] 成员关系已存在，幂等跳过',
  )
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
