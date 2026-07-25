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
  readonly workspaces: typeof import('@/lib/db/schema/index')['workspaces']
  readonly sql: typeof import('drizzle-orm')['sql']
}> {
  const [{ loadEnvConfig }, { sql }, { getDb, LOCAL_WORKSPACE_ID }, { workspaces }, { saveApiKey, validateKey }, { saveGeminiApiKey }, { validateGeminiKey }] = await Promise.all([
    import('@next/env'),
    import('drizzle-orm'),
    import('@/lib/db/client'),
    import('@/lib/db/schema/index'),
    import('@/features/ai/stepfun-adapter'),
    import('@/features/ai/gemini-config'),
    import('@/features/ai/gemini-adapter'),
  ])
  return {
    loadEnvConfig, sql, getDb, LOCAL_WORKSPACE_ID, workspaces,
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

async function main(): Promise<void> {
  business = await loadBusiness()
  business.loadEnvConfig(process.cwd())
  const database = await ensureDatabaseReady()
  await ensureLocalWorkspace(database)

  let written = 0
  let skipped = 0
  let failed = 0
  for (const provider of PROVIDERS) {
    const result = await processProvider(provider)
    if (result === 'written') written += 1
    else if (result === 'skipped') skipped += 1
    else failed += 1
  }

  process.stdout.write(
    `\n[bootstrap-credentials] written=${written} skipped=${skipped} failed=${failed}\n`,
  )
  if (written === 0 && failed === 0) {
    process.stderr.write(
      '[bootstrap-credentials] no key was written; fill GEMINI_API_KEY and/or '
        + 'STEPFUN_API_KEY in .env.local before rerunning\n',
    )
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

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[bootstrap-credentials] fatal: ${message}\n`)
  process.exitCode = 1
})