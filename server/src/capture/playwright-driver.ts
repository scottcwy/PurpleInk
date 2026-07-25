// 从 Firenze frameproof/src/lib/agents/playwright-driver.ts 移植（仅改导入路径）。
import { chromium, type Browser, type Page } from "playwright"
import type { LaunchOptions, SemanticSnapshot } from "../types/capture"
import type { BrowserDriver } from "./browser-driver"

const DEFAULT_TIMEOUT = 30_000
/** 首屏导航单独放宽：重站/慢网下 domcontentloaded 常 >30s（浏览器导航比裸 curl 开销大）。 */
const NAV_TIMEOUT = 60_000

/**
 * PlaywrightDriver — 生产环境主力浏览器驱动
 * 基于 Playwright Chromium，所有操作包 try-catch，超时 30 秒
 */
export class PlaywrightDriver implements BrowserDriver {
  private browser: Browser | null = null
  private page: Page | null = null

  async launch(options?: LaunchOptions): Promise<void> {
    try {
      this.browser = await chromium.launch({
        headless: options?.headless ?? true,
      })
      const context = await this.browser.newContext({
        viewport: options?.viewport ?? { width: 1280, height: 720 },
        deviceScaleFactor: 2,
      })
      // tsx(esbuild) 的 keepNames 会给注入浏览器的具名函数包一层 __name(...)，
      // 而页面上下文没有 __name → page.evaluate 抛 ReferenceError（品牌色/字体抓取
      // 因此降级到默认调色板）。用字符串形式（不被 esbuild 转换）注入兜底垫片，
      // 每次导航前都为主世界补上 __name，保证注入函数可正常执行。
      await context.addInitScript({
        content: "globalThis.__name = globalThis.__name || function (target) { return target; };",
      })
      this.page = await context.newPage()
      console.log("[PlaywrightDriver] Browser launched")
    } catch (err) {
      console.error("[PlaywrightDriver] launch failed:", err)
      throw err
    }
  }

  async navigate(url: string): Promise<void> {
    try {
      await this.getPage().goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT,
      })
      // Extra wait for dynamic content (avoids networkidle timeout on WS/SSE connections)
      await this.getPage().waitForTimeout(2000)
      console.log(`[PlaywrightDriver] Navigated to ${url}`)
    } catch (err) {
      console.error("[PlaywrightDriver] navigate failed:", err)
      throw err
    }
  }

  async snapshot(): Promise<SemanticSnapshot> {
    try {
      const page = this.getPage()
      const title = await page.title()
      const url = page.url()

      const elements = await page.evaluate(() => {
        const selectors =
          "button, a, input, textarea, select, h1, h2, h3, img, [role='button'], [contenteditable='true']"
        const nodes = document.querySelectorAll(selectors)
        const result: Array<Record<string, unknown>> = []
        let ref = 0
        nodes.forEach((el) => {
          const rect = el.getBoundingClientRect()
          const style = window.getComputedStyle(el)
          // 跳过不可见 / 零尺寸元素（图片除外，保留以供分镜）
          const tag = el.tagName.toLowerCase()
          const hidden =
            style.display === "none" ||
            style.visibility === "hidden" ||
            (rect.width === 0 && rect.height === 0)
          if (hidden && tag !== "img") return

          // 打上稳定引用，供 click/fill 精确定位
          el.setAttribute("data-fp-ref", String(ref))

          const inputType = tag === "input" ? (el.getAttribute("type") || "text") : undefined
          const name = el.getAttribute("name") || undefined
          const placeholder = el.getAttribute("placeholder") || undefined
          const role =
            el.getAttribute("role") ||
            (tag === "a" ? "link" : tag === "button" ? "button" : tag === "input" ? "textbox" : "")
          const text =
            tag === "img"
              ? el.getAttribute("alt") || ""
              : ((el as HTMLElement).innerText ||
                 el.getAttribute("placeholder") ||
                 el.getAttribute("aria-label") ||
                 el.getAttribute("value") ||
                 "")

          result.push({
            ref,
            tag,
            role,
            text,
            type: inputType,
            name,
            placeholder,
            selector: `[data-fp-ref="${ref}"]`,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
          })
          ref++
        })
        return result
      })

      const textContent = await page.evaluate(() => document.body?.innerText || "")

      return { title, url, elements: elements as SemanticSnapshot["elements"], textContent }
    } catch (err) {
      console.error("[PlaywrightDriver] snapshot failed:", err)
      throw err
    }
  }

  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    const page = this.getPage()
    try {
      // 限定 12s：部分站点截图会卡在 Playwright "waiting for fonts to load"（等 document.fonts.ready）。
      const buf = await page.screenshot({ type: "png", fullPage: options?.fullPage ?? false, timeout: 12_000 })
      // 全页截图防护：超过 15MB 回退 viewport
      if (options?.fullPage && buf.length > 15 * 1024 * 1024) {
        console.warn("[PlaywrightDriver] fullpage screenshot too large, falling back to viewport:", buf.length)
        const buf2 = await page.screenshot({ type: "png", fullPage: false, timeout: 12_000 })
        return Buffer.from(buf2)
      }
      return Buffer.from(buf)
    } catch (err) {
      // 字体/资源迟迟不 ready 导致 Playwright 截图挂起时，退回 CDP 直接抓当前帧（不等字体）。
      console.warn("[PlaywrightDriver] screenshot timed out, falling back to CDP:", String(err))
      try {
        const client = await page.context().newCDPSession(page)
        const { data } = await client.send("Page.captureScreenshot", { format: "png" })
        await client.detach().catch(() => {})
        return Buffer.from(data, "base64")
      } catch (cdpErr) {
        console.error("[PlaywrightDriver] CDP screenshot failed:", cdpErr)
        throw cdpErr
      }
    }
  }

  /** ④ 截图前静置：等字体 + 两帧 rAF + 固定延时，给 marquee/懒加载/入场动画渲染时间 */
  async settle(ms = 900): Promise<void> {
    const page = this.getPage()
    try {
      await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {})
      await page
        .evaluate(() => new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))))
        .catch(() => {})
    } catch {
      /* ignore */
    }
    await page.waitForTimeout(ms).catch(() => {})
  }

  /** ④ 元素级紧裁截图：单独截出目标容器；太小(< 200×120)或失败则返回 null 让上层回退整帧 */
  async screenshotElement(selector: string): Promise<Buffer | null> {
    const page = this.getPage()
    try {
      const loc = page.locator(selector).first()
      await loc.scrollIntoViewIfNeeded({ timeout: 5_000 })
      await loc.waitFor({ state: "visible", timeout: 5_000 })
      const box = await loc.boundingBox()
      if (!box || box.width < 200 || box.height < 120) return null
      const buf = await loc.screenshot({ type: "png", timeout: 8_000 })
      return Buffer.from(buf)
    } catch (err) {
      console.warn("[PlaywrightDriver] screenshotElement failed:", String(err))
      return null
    }
  }

  /** 元素级抠图：透明底 PNG，用于素材提取；元素不存在或太小(< 20px)返回 null */
  async elementScreenshot(selector: string): Promise<Buffer | null> {
    const page = this.getPage()
    try {
      const loc = page.locator(selector).first()
      await loc.waitFor({ state: "visible", timeout: 5_000 })
      const box = await loc.boundingBox()
      if (!box || box.width < 20 || box.height < 20) return null
      const buf = await loc.screenshot({ omitBackground: true, type: "png", timeout: 8_000 })
      return Buffer.from(buf)
    } catch (err) {
      console.warn("[PlaywrightDriver] elementScreenshot failed:", String(err))
      return null
    }
  }

  /** 提取关键元素坐标布局；缺省选择器时自动提取常见元素 */
  async extractLayout(selectors?: string[]): Promise<Array<{ selector: string; x: number; y: number; w: number; h: number }>> {
    const page = this.getPage()
    const defaultSelectors = [
      "nav", "header", "main", "footer", "h1", "h2",
      "[class*='hero']", "[class*='card']", "button",
      "[class*='btn']", "[class*='cta']", "[class*='logo']",
    ]
    const sels = selectors ?? defaultSelectors
    try {
      const results = await page.evaluate((selectorList: string[]) => {
        const out: Array<{ selector: string; x: number; y: number; w: number; h: number }> = []
        for (const sel of selectorList) {
          try {
            const els = document.querySelectorAll(sel)
            els.forEach((el) => {
              const rect = el.getBoundingClientRect()
              const style = window.getComputedStyle(el)
              // 跳过不可见或太小的元素
              if (style.display === "none" || style.visibility === "hidden") return
              if (rect.width < 20 || rect.height < 20) return
              out.push({
                selector: sel,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height),
              })
            })
          } catch {
            // 单个选择器失败不影响整体
          }
        }
        return out
      }, sels)
      return results
    } catch (err) {
      console.warn("[PlaywrightDriver] extractLayout failed:", String(err))
      return []
    }
  }

  async click(selector: string): Promise<void> {
    try {
      await this.getPage().click(selector, { timeout: DEFAULT_TIMEOUT })
      console.log(`[PlaywrightDriver] Clicked: ${selector}`)
    } catch (err) {
      console.error("[PlaywrightDriver] click failed:", err)
      throw err
    }
  }

  async fill(selector: string, value: string): Promise<void> {
    try {
      await this.getPage().fill(selector, value, { timeout: DEFAULT_TIMEOUT })
      console.log(`[PlaywrightDriver] Filled: ${selector}`)
    } catch (err) {
      console.error("[PlaywrightDriver] fill failed:", err)
      throw err
    }
  }

  async scroll(direction: "down" | "up" | "left" | "right"): Promise<void> {
    try {
      const delta = 500
      const scrollMap = {
        down: { x: 0, y: delta },
        up: { x: 0, y: -delta },
        left: { x: -delta, y: 0 },
        right: { x: delta, y: 0 },
      }
      const { x, y } = scrollMap[direction]
      await this.getPage().evaluate(
        ([dx, dy]) => window.scrollBy(dx, dy),
        [x, y] as [number, number]
      )
      console.log(`[PlaywrightDriver] Scrolled ${direction}`)
    } catch (err) {
      console.error("[PlaywrightDriver] scroll failed:", err)
      throw err
    }
  }

  async pressKey(key: string): Promise<void> {
    try {
      await this.getPage().keyboard.press(key)
      console.log(`[PlaywrightDriver] Pressed key: ${key}`)
    } catch (err) {
      console.error("[PlaywrightDriver] pressKey failed:", err)
      throw err
    }
  }

  async getCurrentUrl(): Promise<string> {
    return this.getPage().url()
  }

  async waitFor(selector: string, timeout?: number): Promise<void> {
    try {
      await this.getPage().waitForSelector(selector, {
        timeout: timeout ?? DEFAULT_TIMEOUT,
      })
      console.log(`[PlaywrightDriver] Waited for: ${selector}`)
    } catch (err) {
      console.error("[PlaywrightDriver] waitFor failed:", err)
      throw err
    }
  }

  async evaluate<T>(fn: string | (() => T)): Promise<T> {
    try {
      const result = await this.getPage().evaluate(fn as never)
      return result as T
    } catch (err) {
      console.error("[PlaywrightDriver] evaluate failed:", err)
      throw err
    }
  }

  async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close()
        this.browser = null
        this.page = null
        console.log("[PlaywrightDriver] Browser closed")
      }
    } catch (err) {
      console.error("[PlaywrightDriver] close failed:", err)
      throw err
    }
  }

  /* ---------- helpers ---------- */

  private getPage(): Page {
    if (!this.page) throw new Error("[PlaywrightDriver] Browser not launched — call launch() first")
    return this.page
  }
}
