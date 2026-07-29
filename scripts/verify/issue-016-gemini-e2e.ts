import { spawn } from 'node:child_process'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

async function main(): Promise<void> {
  const account = process.env.CVC_VERIFY_ACCOUNT
    ?? demoVerificationAccount()
  if (!account) {
    throw new Error('缺少本地验证账号配置')
  }
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/verify/e2e-smoke.ts',
      '--script',
      'docs/issues/evidence/fixtures/issue-016-seven-shots.txt',
      '--title',
      `ISSUE-016 Gemini E2E ${new Date().toISOString()}`,
      '--timeout',
      '2400',
      '--report',
      'docs/issues/evidence/issue-016/gemini-7-shot-report.json',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, CVC_VERIFY_ACCOUNT: account },
      stdio: 'inherit',
      windowsHide: true,
    }
  )
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0) {
    throw new Error(`Gemini 真实 E2E 子进程退出码 ${exitCode}`)
  }
}

function demoVerificationAccount(): string | undefined {
  const email = process.env.CVC_DEMO_ACCOUNT_EMAIL
  const password = process.env.CVC_DEMO_ACCOUNT_PASSWORD
  return email && password ? `${email}:${password}` : undefined
}

main().catch((error: unknown) => {
  console.error(`[issue-016] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
