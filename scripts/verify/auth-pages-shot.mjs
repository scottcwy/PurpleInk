// 一次性取证脚本：认证三页的真实 Chromium 截图 + 控制台/网络错误检查。
// 只读页面、不提交凭据，不产生业务数据。
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE = process.env.CVC_SHOT_BASE_URL ?? 'http://localhost:3000'
const OUT = 'docs/issues/evidence/auth'
const PAGES = [
  ['login', '/login'],
  ['signup', '/signup'],
  ['password-reset', '/password/reset'],
]
const VIEWPORTS = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const problems = []

for (const [viewportName, viewport] of VIEWPORTS) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 })
  for (const [name, path] of PAGES) {
    const page = await context.newPage()
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`${viewportName} ${path} console.${message.type()}: ${message.text()}`)
      }
    })
    page.on('requestfailed', (request) => {
      problems.push(`${viewportName} ${path} requestfailed: ${request.url()}`)
    })
    const posterBytes = []
    page.on('response', async (response) => {
      if (!response.url().includes('login')) return
      if (!/image|_next\/image/.test(response.url() + (response.headers()['content-type'] ?? ''))) {
        return
      }
      const length = Number(response.headers()['content-length'] ?? 0)
      posterBytes.push(`${length || '?'}B ${response.url().slice(0, 110)}`)
    })
    const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
    if (response?.status() !== 200) {
      problems.push(`${viewportName} ${path} status=${response?.status()}`)
    }
    // 海报在移动端必须完全不存在于 DOM，而不是被 CSS 隐藏。
    const posterCount = await page.locator('img[src*="login"]').count()
    console.log(
      `${viewportName} ${path} poster-img-nodes=${posterCount} `
      + `poster-requests=[${posterBytes.join(' | ') || 'none'}]`,
    )
    // 版式断言：桌面端左栏必须是「左半屏 + 通栏满高」，右栏表单落在右半屏内。
    const poster = await page.locator('aside').boundingBox()
    const form = await page.locator('main form').boundingBox()
    if (viewportName === 'desktop') {
      const half = viewport.width / 2
      if (!poster) problems.push(`${path} 桌面端缺少海报栏`)
      else {
        if (Math.abs(poster.x) > 1) problems.push(`${path} 海报未贴左边缘 x=${poster.x}`)
        if (Math.abs(poster.width - half) > 2) {
          problems.push(`${path} 海报宽度非半屏 ${poster.width} vs ${half}`)
        }
        if (Math.abs(poster.height - viewport.height) > 2) {
          problems.push(`${path} 海报未通栏满高 ${poster.height} vs ${viewport.height}`)
        }
      }
      if (form && form.x < half) problems.push(`${path} 表单越入左半屏 x=${form.x}`)
    } else if (poster && poster.width > 0) {
      problems.push(`${path} 移动端海报未折叠 width=${poster.width}`)
    }
    await page.screenshot({ path: `${OUT}/${name}-${viewportName}.png`, fullPage: true })
    await page.close()
  }
  await context.close()
}

await browser.close()
if (problems.length > 0) {
  console.error('PROBLEMS:\n' + problems.join('\n'))
  process.exit(1)
}
console.log('OK: no console errors/warnings, no failed requests')
