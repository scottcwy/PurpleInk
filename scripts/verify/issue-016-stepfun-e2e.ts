import { spawn } from 'node:child_process'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

const BASE_URL = process.env.CVC_E2E_BASE_URL ?? 'http://localhost:3000'
const TEXT_ROUTE_KEYS = [
  'script-import',
  'shot-split',
  'score',
  'export',
  'shot-script',
  'shot-codegen',
  'shot-qa',
] as const

interface SettingsRoute {
  provider: string
}

interface SettingsResponse {
  routes: Record<string, SettingsRoute>
}

async function main(): Promise<void> {
  const account = verificationAccount()
  const cookie = await login(account.email, account.password)
  const settings = await readSettings(cookie)
  const originalRoutes = Object.fromEntries(
    TEXT_ROUTE_KEYS.map((key) => [
      key,
      settings.routes[key]?.provider,
    ])
  )
  if (Object.values(originalRoutes).some((provider) => !provider)) {
    throw new Error('当前模型路由快照不完整，拒绝执行可恢复切换')
  }

  try {
    await saveRoutes(cookie, Object.fromEntries(
      TEXT_ROUTE_KEYS.map((key) => [key, 'stepfun'])
    ))
    console.log('[issue-016] 已临时切换文本与视觉路由到 StepFun，媒体路由保持原配置')
    const exitCode = await runSmoke(account.raw)
    if (exitCode !== 0) {
      throw new Error(`真实 E2E 子进程退出码 ${exitCode}`)
    }
  } finally {
    await saveRoutes(cookie, originalRoutes as Record<string, string>)
    console.log('[issue-016] 已恢复测试工作区原模型路由')
  }
}

function verificationAccount(): { email: string; password: string; raw: string } {
  const raw = process.env.CVC_VERIFY_ACCOUNT
    ?? joinAccount(
      process.env.CVC_DEMO_ACCOUNT_EMAIL,
      process.env.CVC_DEMO_ACCOUNT_PASSWORD
    )
  const separator = raw.indexOf(':')
  if (separator < 1) throw new Error('缺少可用的本地 E2E 账号')
  return {
    email: raw.slice(0, separator),
    password: raw.slice(separator + 1),
    raw,
  }
}

function joinAccount(email: string | undefined, password: string | undefined): string {
  if (!email || !password) return ''
  return `${email}:${password}`
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const match = /cvc_session=([^;]+)/.exec(response.headers.get('set-cookie') ?? '')
  if (!response.ok || !match) throw new Error(`E2E 登录失败（HTTP ${response.status}）`)
  return `cvc_session=${match[1]}`
}

async function readSettings(cookie: string): Promise<SettingsResponse> {
  const response = await fetch(`${BASE_URL}/api/settings`, { headers: { cookie } })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok || !isSettingsResponse(body)) {
    throw new Error(`读取测试工作区路由失败（HTTP ${response.status}）`)
  }
  return body
}

async function saveRoutes(
  cookie: string,
  routes: Record<string, string>
): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/settings`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ routes }),
  })
  if (!response.ok) {
    throw new Error(`保存测试工作区路由失败（HTTP ${response.status}）`)
  }
}

function runSmoke(account: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/verify/e2e-smoke.ts',
        '--script',
        'docs/issues/evidence/fixtures/issue-016-seven-shots.txt',
        '--title',
        `ISSUE-016 StepFun 5 RPM ${new Date().toISOString()}`,
        '--timeout',
        '2400',
        '--report',
        'docs/issues/evidence/issue-016/stepfun-7-shot-report.json',
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CVC_VERIFY_ACCOUNT: account },
        stdio: 'inherit',
        windowsHide: true,
      }
    )
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

function isSettingsResponse(value: unknown): value is SettingsResponse {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).routes
    && typeof (value as Record<string, unknown>).routes === 'object'
  )
}

main().catch((error: unknown) => {
  console.error(`[issue-016] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
