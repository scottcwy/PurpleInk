import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export interface StaticGateResult {
  passed: boolean
  errors: string[]
  checks: string[]
}

export interface RuntimeGateResult {
  passed: boolean
  errors: string[]
  screenshotHashes: string[]
}

export function validateShotHtml(html: string): StaticGateResult {
  const errors: string[] = []
  const checks: string[] = []
  if (html.length > 1_000_000) errors.push('source size exceeds limit')
  else checks.push('source-size')
  if (!/<html[\s>]/iu.test(html) || !/<body[\s>]/iu.test(html)) {
    errors.push('document structure is incomplete')
  } else checks.push('document-structure')
  if (!/window\.__PURPLEINK_RENDER__/u.test(html) || !/ready\s*:\s*true/u.test(html)) {
    errors.push('render metadata is missing')
  } else checks.push('render-metadata')
  if (!/durationSec\s*:/u.test(html)) errors.push('render duration metadata is missing')
  else checks.push('render-duration')
  if (!/data-pi-seed\s*=/iu.test(html)) errors.push('deterministic seed is missing')
  else checks.push('deterministic-seed')
  if (/https?:\/\//iu.test(html) || /url\(\s*['"]?data:/iu.test(html)) {
    errors.push('network or data URL resource is not allowed')
  } else checks.push('local-resources')
  if (/(?:api[_-]?key|authorization|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9]{12,})/iu.test(html)) {
    errors.push('credential-like content is not allowed')
  } else checks.push('credential-scan')
  if (/\beval\s*\(|new\s+Function\s*\(/iu.test(html)) {
    errors.push('dynamic code evaluation is not allowed')
  } else checks.push('dynamic-code-scan')
  return { passed: errors.length === 0, errors, checks }
}

export interface RuntimePage {
  goto(url: string, options: { waitUntil: 'load' }): Promise<void>
  waitForFunction(expression: string, options: { timeout: number }): Promise<void>
  evaluate(expression: string, value: number): Promise<void>
  waitForTimeout(milliseconds: number): Promise<void>
  screenshot(options: { type: 'png' }): Promise<Buffer>
  on(event: 'console' | 'pageerror', listener: () => void): void
  close(): Promise<void>
}

export interface RuntimeBrowser {
  newPage(): Promise<RuntimePage>
  close(): Promise<void>
}

export type RuntimeBrowserLauncher = () => Promise<RuntimeBrowser>

export async function runChromiumGate(
  htmlPath: string,
  options: { launch?: RuntimeBrowserLauncher; timeoutMs?: number } = {},
): Promise<RuntimeGateResult> {
  const launch = options.launch ?? defaultBrowserLauncher
  const timeoutMs = options.timeoutMs ?? 30_000
  const browser = await launch()
  const page = await browser.newPage()
  let browserError = false
  page.on('console', () => {
    browserError = true
  })
  page.on('pageerror', () => {
    browserError = true
  })
  const screenshotHashes: string[] = []
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await page.waitForFunction('window.__PURPLEINK_RENDER__ && window.__PURPLEINK_RENDER__.ready === true', {
      timeout: timeoutMs,
    })
    for (const progress of [0, 0.5, 1]) {
      await page.evaluate(
        '(progress) => { const r = window.__PURPLEINK_RENDER__; if (r && typeof r.seek === "function") r.seek(progress); document.documentElement.dataset.renderProgress = String(progress); }',
        progress,
      )
      await page.waitForTimeout(50)
      const screenshot = await page.screenshot({ type: 'png' })
      screenshotHashes.push(createHash('sha256').update(screenshot).digest('hex'))
    }
  } catch {
    return { passed: false, errors: ['BROWSER_GATE_FAILED'], screenshotHashes }
  } finally {
    await page.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
  return {
    passed: !browserError,
    errors: browserError ? ['BROWSER_CONSOLE_ERROR'] : [],
    screenshotHashes,
  }
}

async function defaultBrowserLauncher(): Promise<RuntimeBrowser> {
  const playwright = await import('playwright')
  return (await playwright.chromium.launch({ headless: true })) as unknown as RuntimeBrowser
}
