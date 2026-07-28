/**
 * Bootstrap AI provider credentials into Postgres 加密存储。
 *
 * 仅在冷启动时运行一次：读根 `.env.local` 中 GEMINI_API_KEY / STEPFUN_API_KEY
 * 作为本地中转，经真实 API 验证后写入 `provider_credentials` 加密存储；
 * 运行时永远只读 DB，不回退 env（AGENTS.md §7 + 契约测试 config.test.ts:119
 * + gemini-config.test.ts:93 双向锁定）。本脚本是 `provision-master-key.ts`
 * 在凭据维度的对称实现。
 *
 * 不读 `server/.env`（issue §3 边界），不回显 secret 值；失败立即非 0 退出。
 *
 * Runtime note: src/lib/db/client.ts 与 src/features/ai/** 用 `import 'server-only'`
 * 作为 Next 进程哨兵。在 Next runtime 之外由本脚本直接跑时，需要先把该 bare
 * specifier 重定向到 ./server-only-stub.js 的空模块，再 dynamic-import 业务模块。
 */
import { createRequire } from 'node:module'

interface ProviderPlan {
  readonly name: 'Gemini' | 'StepFun'
  readonly envKey: string
  readonly validate: (apiKey: string) => Promise<boolean>
  readonly save: (apiKey: string) => Promise<void>
}

const require = createRequire(import.meta.url)

function installServerOnlyShim(): void {
  const stubPath = require.resolve('./server-only-stub.js')
  const Module = require('node:module') as typeof import('node:module')
  const original = (
    Module as unknown as { _resolveFilename: (...args: unknown[]) => string }
  )._resolveFilename
  ;(
    Module as unknown as { _resolveFilename: (...args: unknown[]) => string }
  )._resolveFilename = function (request: unknown, ...rest: unknown[]): string {
    if (request === 'server-only') return stubPath
    return original.call(this, request, ...rest)
  }
}

installServerOnlyShim()

async function loadBusiness(): Promise<{
  readonly loadEnvConfig: typeof import('@next/env')['loadEnvConfig']
  readonly saveApiKey: typeof import('@/features/ai/stepfun-adapter')['saveApiKey']
  readonly validateKey: typeof import('@/features/ai/stepfun-adapter')['validateKey']
  readonly saveGeminiApiKey: typeof import('@/features/ai/gemini-config')['saveGeminiApiKey']
  readonly validateGeminiKey: typeof import('@/features/ai/gemini-adapter')['validateGeminiKey']
  readonly getDb: typeof import('@/lib/db/client')['getDb']
  readonly LOCAL_WORKSPACE_ID: typeof import('@/lib/db/client')['LOCAL_WORKSPACE_ID']
  readonly runInAuthContext: typeof import('@/lib/auth/workspace-context')['runInAuthContext']
  readonly workspaces: typeof import('@/lib/db/schema/index')['workspaces']
  readonly sql: typeof import('drizzle-orm')['sql']
}> {
  const [{ loadEnvConfig }, { sql }, { getDb, LOCAL_WORKSPACE_ID }, { runInAuthContext }, { workspaces }, { saveApiKey, validateKey }, { saveGeminiApiKey }, { validateGeminiKey }] = await Promise.all([
    import('@next/env'),
    import('drizzle-orm'),
    import('@/lib/db/client'),
    import('@/lib/auth/workspace-context'),
    import('@/lib/db/schema/index'),
    import('@/features/ai/stepfun-adapter'),
    import('@/features/ai/gemini-config'),
    import('@/features/ai/gemini-adapter'),
  ])
  return {
    loadEnvConfig, sql, getDb, LOCAL_WORKSPACE_ID, runInAuthContext, workspaces,
    saveApiKey, validateKey,
    saveGeminiApiKey, validateGeminiKey,
  }
}

const PROVIDERS: readonly ProviderPlan[] = [
  {
    name: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    validate: (k) => Promise.resolve(k).then((apiKey) => business.validateGeminiKey(apiKey)),
    save: (k) => business.saveGeminiApiKey(k),
  },
  {
    name: 'StepFun',
    envKey: 'STEPFUN_API_KEY',
    validate: (k) => Promise.resolve(k).then((apiKey) => business.validateKey(apiKey)),
    save: (k) => business.saveApiKey(k),
  },
]

let business: Awaited<ReturnType<typeof loadBusiness>>

const allowEmpty = process.argv.includes('--allow-empty')

async function main(): Promise<void> {
  business = await loadBusiness()
  business.loadEnvConfig(process.cwd())
  const database = await ensureDatabaseReady()
  await ensureLocalWorkspace(database)

  let written = 0
  let skipped = 0
  let failed = 0
  // 业务侧 save/validate 经 `currentWorkspaceId()` 取归属（PLAN-002 阶段 B）；
  // bootstrap 是单 workspace 冷启动脚本，只写首个 owner workspace（历史锚点），
  // 其余用户经设置页自行写入（docs/configuration/credentials.md §3）。
  await business.runInAuthContext(
    { workspaceId: business.LOCAL_WORKSPACE_ID, userId: 'system:bootstrap' },
    async () => {
      for (const provider of PROVIDERS) {
        const result = await processProvider(provider)
        if (result === 'written') written += 1
        else if (result === 'skipped') skipped += 1
        else failed += 1
      }
    },
  )

  process.stdout.write(
    `\n[bootstrap-credentials] written=${written} skipped=${skipped} failed=${failed}\n`,
  )
  if (written === 0 && failed === 0) {
    // `--allow-empty` 供容器编排使用：生产 compose 把本脚本作为 `next` 的
    // `service_completed_successfully` 前置，若「没提供 Key」也算失败退出，
    // 整个栈就起不来了。而应用本身没有凭据也能正常启动（凭据只在跑管线时才
    // 需要），因此这种情况应当放行并如实提示，而不是阻断部署。
    // 校验失败（failed > 0）仍然退出 1：那是配置错了，必须响。
    const message =
      '[bootstrap-credentials] no key was written; set GEMINI_API_KEY and/or '
      + 'STEPFUN_API_KEY before rerunning\n'
    if (allowEmpty) {
      process.stdout.write(message)
      return
    }
    process.stderr.write(message)
    process.exitCode = 2
    return
  }
  if (failed > 0) process.exitCode = 1
}

async function processProvider(provider: ProviderPlan): Promise<'written' | 'skipped' | 'failed'> {
  const envValue = process.env[provider.envKey]?.trim()
  if (!envValue) {
    process.stdout.write(`[${provider.name}] skipped (env ${provider.envKey} empty)\n`)
    return 'skipped'
  }
  process.stdout.write(`[${provider.name}] validating via real API...\n`)
  const isValid = await provider.validate(envValue).catch((error) => {
    const errorType = error instanceof Error ? error.name : 'UnknownError'
    process.stderr.write(
      `[${provider.name}] validate threw ${errorType}; not writing\n`,
    )
    return false
  })
  if (!isValid) {
    process.stderr.write(
      `[${provider.name}] validation failed; existing stored key left untouched\n`,
    )
    return 'failed'
  }
  await provider.save(envValue)
  process.stdout.write(`[${provider.name}] configured (verifiedAt=now)\n`)
  // 清空中转 env，避免进程后续意外暴露（脚本退出由 OS 自动回收，这里只是防护）
  process.env[provider.envKey] = ''
  return 'written'
}

async function ensureDatabaseReady() {
  try {
    const database = await business.getDb()
    await database.execute(business.sql`select 1`)
    return database
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `database unreachable; run pnpm db:migrate first. detail: ${message}`,
    )
  }
}

async function ensureLocalWorkspace(database: Awaited<ReturnType<typeof business.getDb>>): Promise<void> {
  await database
    .insert(business.workspaces)
    .values({
      id: business.LOCAL_WORKSPACE_ID,
      slug: 'local',
      name: 'Local Workspace',
    })
    .onConflictDoNothing()
}

/**
 * 显式退出。`getDb()` 的连接锚在 globalThis 上、由 Next 进程长期复用，脚本侧
 * 没有关闭出口，不退出会让进程一直挂着（实测 300s 未结束）。
 *
 * 这在容器编排里是**阻断级**的：生产 compose 把本脚本作为 `next` 的
 * `service_completed_successfully` 前置，进程不退出就等于该条件永远不满足，
 * 整个栈起不来。
 */
function exitWithCurrentCode(): never {
  process.exit(process.exitCode ?? 0)
}

void main().then(exitWithCurrentCode).catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[bootstrap-credentials] fatal: ${message}\n`)
  process.exit(1)
})