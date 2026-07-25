import { chromium, type Page } from 'playwright'

const baseUrl = readFlag('--base-url') ?? 'http://localhost:3000'
const viewport = { width: 1440, height: 650 }

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport })
  const browserErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))

  try {
    await verifyMarketingScroll(page)
    await verifyClientNavigationCleanup(page)
    await verifyProductsScroll(page)
    await verifyNonMarketingRoutes(page)
    assert(browserErrors.length === 0, `浏览器错误：${browserErrors.join(' | ')}`)
    console.log('[products-scroll] PASS')
  } finally {
    await browser.close()
  }
}

async function verifyMarketingScroll(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.documentElement.classList.contains('lenis'))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.mouse.move(900, 400)
  await page.mouse.wheel(0, 400)
  await page.waitForFunction(() => window.scrollY > 0)
  console.log('[products-scroll] marketing window scroll PASS')
}

async function verifyClientNavigationCleanup(page: Page): Promise<void> {
  await page
    .getByRole('link', { name: 'Try it' })
    .evaluate((link: HTMLAnchorElement) => link.click())
  await page.waitForURL('**/products/projects')
  await page.waitForTimeout(250)
  const hasLenis = await page.evaluate(() =>
    document.documentElement.classList.contains('lenis'),
  )
  assert(!hasLenis, '离开营销路由后应清理 html.lenis')
  console.log('[products-scroll] marketing cleanup PASS')
}

async function verifyProductsScroll(page: Page): Promise<void> {
  await page.goto(`${baseUrl}/products/settings`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => {
    const main = document.querySelector('main')
    return main !== null && main.scrollHeight > main.clientHeight
  })
  const hasLenis = await page.evaluate(() =>
    document.documentElement.classList.contains('lenis'),
  )
  assert(!hasLenis, '产品设置页不应挂载 html.lenis')

  const main = page.locator('main')
  const bounds = await main.boundingBox()
  assert(bounds !== null, '产品设置页缺少可见 main')
  await main.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, 400)
  await page.waitForFunction(() => (document.querySelector('main')?.scrollTop ?? 0) > 0)
  console.log('[products-scroll] products native scroll PASS')
}

async function verifyNonMarketingRoutes(page: Page): Promise<void> {
  for (const route of ['/login', '/release', '/playbook']) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' })
    const hasLenis = await page.evaluate(() =>
      document.documentElement.classList.contains('lenis'),
    )
    assert(!hasLenis, `${route} 不应挂载 html.lenis`)
  }
  console.log('[products-scroll] non-marketing boundary PASS')
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

main().catch((error: unknown) => {
  console.error(`[products-scroll] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
