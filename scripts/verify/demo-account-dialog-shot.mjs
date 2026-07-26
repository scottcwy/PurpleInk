// 体验账号弹窗的真实 Chromium 取证：自动出现 → 一键填入直达应用 → 可关闭可重开。
// 需要先设置 CVC_DEMO_ACCOUNT_EMAIL / CVC_DEMO_ACCOUNT_PASSWORD 并跑过
// scripts/setup/seed-owner-account.ts。
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = process.env.CVC_SHOT_BASE_URL ?? 'http://localhost:3000'
const OUT = 'docs/issues/evidence/auth'
const problems = []

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`console.${message.type()}: ${message.text()}`)
  }
})

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
const dialog = page.locator('[role="dialog"]')
if ((await dialog.count()) !== 1) problems.push('弹窗未自动出现')
if (!(await dialog.getAttribute('aria-modal'))) problems.push('弹窗缺少 aria-modal')
console.log('标题:', (await dialog.locator('h2, h3').first().textContent())?.trim())
await page.screenshot({ path: `${OUT}/demo-account-dialog.png` })

await dialog.getByRole('button', { name: '填入并登录' }).click()
await page.waitForURL('**/products/dashboard', { timeout: 20_000 }).catch(() => {
  problems.push(`一键填入后未进入应用，停在 ${page.url()}`)
})
console.log('一键填入后 URL:', page.url())

// 关闭与重开路径
await context.clearCookies()
const second = await context.newPage()
await second.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await second.locator('[role="dialog"]').getByRole('button', { name: '我自己输入' }).click()
if ((await second.locator('[role="dialog"]').count()) !== 0) problems.push('点「我自己输入」未关闭弹窗')
if ((await second.locator('input[type="email"]').inputValue()) !== '') {
  problems.push('关闭弹窗后表单被意外预填')
}
await second.getByRole('button', { name: '查看体验账号' }).click()
if ((await second.locator('[role="dialog"]').count()) !== 1) problems.push('无法重新打开弹窗')

await browser.close()
if (problems.length > 0) {
  console.error('PROBLEMS:\n' + problems.join('\n'))
  process.exit(1)
}
console.log('OK: 自动出现、一键填入直达应用、可关闭可重开，控制台无 error/warning')
