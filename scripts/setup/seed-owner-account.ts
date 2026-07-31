/**
 * 本地开发用：直接建一个可登录账号，并把它设为某个 workspace 的 owner。
 *
 * 为什么需要它：注册流程要过邮件验证码，而验证码依赖出站 SMTP。本机代理以
 * TUN + fake-ip 模式劫持 DNS 时 SMTP 握手失败（nodemailer 报 ESOCKET/CONN），
 * 注册就走不通。本脚本**绕过验证码**建号，因此它只服务本地开发与取证，
 * 不是产品路径，也不在任何 HTTP 表面暴露。
 *
 * 同时它承担 PLAN-002 §5.5 的归属迁移：默认把账号绑成 `LOCAL_WORKSPACE_ID`
 * 的 owner，**不搬数据、不改任何业务行的 workspaceId**，只补一条成员关系。
 * 这是最小且可逆的做法，也让阶段 B 收口后这个账号能继续看到既有项目。
 *
 * 幂等：重复执行不报错、不产生第二条成员关系；已存在的账号会更新口令与姓名。
 *
 * 用法（口令为可见的开发默认值，不是 secret；生产环境不得运行本脚本）：
 *   pnpm tsx scripts/setup/seed-owner-account.ts
 *   pnpm tsx scripts/setup/seed-owner-account.ts --email a@b.com --password "..." --workspace new
 *
 * Runtime note: `src/lib/db/client.ts` 用 `import 'server-only'` 作为 Next 进程
 * 哨兵，脚本在 Next runtime 之外跑，需先把该 bare specifier 重定向到空模块，
 * 与其他脱离 Next runtime 的维护脚本使用同一 server-only shim 手法。
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function installServerOnlyShim(): void {
  const stubPath = require.resolve('./server-only-stub.js')
  const Module = require('node:module') as typeof import('node:module')
  const target = Module as unknown as {
    _resolveFilename: (...args: unknown[]) => string
  }
  const original = target._resolveFilename
  target._resolveFilename = function (request: unknown, ...rest: unknown[]): string {
    if (request === 'server-only') return stubPath
    return original.call(this, request, ...rest)
  }
}

installServerOnlyShim()

const DEFAULT_EMAIL = 'dev@purpleink.local'
/** 满足 passwordSchema：≥10 位、同时含数字与非数字。 */
const DEFAULT_PASSWORD = 'PurpleInk-2026'
const DEFAULT_NAME = '本地开发账号'

interface Options {
  email: string
  password: string
  name: string
  /** `local` = 绑定 LOCAL_WORKSPACE_ID（默认）；`new` = 另建一个 workspace。 */
  workspace: 'local' | 'new'
}

function parseArgs(argv: readonly string[]): Options | null {
  const options: Options = {
    email: DEFAULT_EMAIL,
    password: DEFAULT_PASSWORD,
    name: DEFAULT_NAME,
    workspace: 'local',
  }
  // `--from-env` 供容器编排使用：从 CVC_DEMO_ACCOUNT_* 取凭据。
  // 二者任一缺失即返回 null（不建号、退出 0），这样生产 compose 可以无条件挂这个
  // 一次性任务，而「是否真的创建一个公开体验账号」由运维显式设置 env 来决定——
  // 默认不建，避免每次部署都悄悄多一个公开账号。
  if (argv.includes('--from-env')) {
    const email = process.env.CVC_DEMO_ACCOUNT_EMAIL?.trim()
    const password = process.env.CVC_DEMO_ACCOUNT_PASSWORD?.trim()
    if (!email || !password) return null
    options.email = email
    options.password = password
    options.name = process.env.CVC_DEMO_ACCOUNT_NAME?.trim() || DEFAULT_NAME
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) continue
    if (flag === '--email') options.email = value
    else if (flag === '--password') options.password = value
    else if (flag === '--name') options.name = value
    else if (flag === '--workspace' && (value === 'local' || value === 'new')) {
      options.workspace = value
    }
    index += 1
  }
  return options
}

async function main(): Promise<void> {
  const [{ loadEnvConfig }, { eq, sql }, dbClient, schema, { hashPassword }] =
    await Promise.all([
      import('@next/env'),
      import('drizzle-orm'),
      import('@/lib/db/client'),
      import('@/lib/db/schema/index'),
      import('@/features/auth/password'),
    ])
  // 必须在 parseArgs 之前：`--from-env` 读 CVC_DEMO_ACCOUNT_*，容器里这些变量由
  // 编排直接注入，本地则来自 .env.local。若先解析参数，本地跑就会看不到
  // .env.local 里的值而误判为「未设置」。
  loadEnvConfig(process.cwd())

  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    process.stdout.write(
      '[seed-owner-account] 未设置 CVC_DEMO_ACCOUNT_EMAIL / '
      + 'CVC_DEMO_ACCOUNT_PASSWORD，跳过体验账号创建\n',
    )
    process.exit(0)
  }
  const email = options.email.trim().toLowerCase()

  const database = await dbClient.getDb()
  await database.execute(sql`select 1`)

  const passwordHash = await hashPassword(options.password)
  const now = new Date()

  const summary = await database.transaction(async (tx) => {
    // workspace：默认复用 LOCAL_WORKSPACE_ID，让既有数据自然归到这个账号名下。
    let workspaceId: string
    let workspaceName: string
    if (options.workspace === 'local') {
      const [row] = await tx
        .insert(schema.workspaces)
        .values({
          id: dbClient.LOCAL_WORKSPACE_ID,
          slug: 'local',
          name: 'Local Workspace',
        })
        .onConflictDoNothing()
        .returning({ id: schema.workspaces.id, name: schema.workspaces.name })
      if (row) {
        workspaceId = row.id
        workspaceName = row.name
      } else {
        const [existing] = await tx
          .select({ id: schema.workspaces.id, name: schema.workspaces.name })
          .from(schema.workspaces)
          .where(eq(schema.workspaces.id, dbClient.LOCAL_WORKSPACE_ID))
          .limit(1)
        if (!existing) throw new Error('LOCAL_WORKSPACE_ID workspace 既未插入也不存在')
        workspaceId = existing.id
        workspaceName = existing.name
      }
    } else {
      const slug = `dev-${Date.now()}`
      const [row] = await tx
        .insert(schema.workspaces)
        .values({ slug, name: `${options.name} 的 Workspace` })
        .returning({ id: schema.workspaces.id, name: schema.workspaces.name })
      if (!row) throw new Error('workspace 创建失败')
      workspaceId = row.id
      workspaceName = row.name
    }

    // 账号：按 lower(email) 定位，已存在则更新口令与姓名（便于重置本地账号）。
    const [existingUser] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${email}`)
      .limit(1)

    let userId: string
    let created: boolean
    if (existingUser) {
      userId = existingUser.id
      created = false
      await tx
        .update(schema.users)
        .set({
          name: options.name,
          passwordHash,
          // 改口令必须推进 passwordUpdatedAt，否则旧会话不会失效。
          passwordUpdatedAt: now,
          emailVerifiedAt: now,
          status: 'active',
          updatedAt: now,
        })
        .where(eq(schema.users.id, userId))
      // 口令已变：清掉该用户全部旧会话，与 /api/auth/password/reset 同一口径。
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId))
    } else {
      const [row] = await tx
        .insert(schema.users)
        .values({
          email,
          name: options.name,
          passwordHash,
          passwordUpdatedAt: now,
          // 本脚本绕过验证码，因此直接标记邮箱已验证；产品路径不会走到这里。
          emailVerifiedAt: now,
          status: 'active',
        })
        .returning({ id: schema.users.id })
      if (!row) throw new Error('账号创建失败')
      userId = row.id
      created = true
    }

    await tx
      .insert(schema.workspaceMembers)
      .values({ workspaceId, userId, role: 'owner' })
      .onConflictDoNothing()

    return { userId, workspaceId, workspaceName, created }
  })

  process.stdout.write(
    [
      '',
      `[seed-owner-account] ${summary.created ? '已创建' : '已更新'}本地开发账号`,
      `  邮箱      ${email}`,
      `  口令      ${options.password}`,
      `  姓名      ${options.name}`,
      `  workspace ${summary.workspaceName} (${summary.workspaceId})`,
      `  角色      owner`,
      '',
      '  这是本地开发账号，绕过了邮件验证码，禁止在生产环境运行本脚本。',
      '  登录入口 http://localhost:3000/login',
      '',
    ].join('\n'),
  )
  // `getDb()` 的连接锚在 globalThis 上、由 Next 进程长期复用，脚本侧没有关闭出口，
  // 不显式退出会让进程挂住。这里用退出码 0 收尾，不留悬挂连接。
  process.exit(0)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[seed-owner-account] fatal: ${message}\n`)
  process.exitCode = 1
})
