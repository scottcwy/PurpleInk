// 从 Firenze mock-driver.ts 移植，但去掉 sharp 原生依赖：
// 截图返回一枚内嵌的 1x1 有效 PNG，仅用于「不装浏览器」时验证 采集→适配器 全链路。
import type { LaunchOptions, SemanticSnapshot } from "../types/capture"
import type { BrowserDriver } from "./browser-driver"

// 1x1 透明 PNG（合法 PNG 字节流，供适配器写盘 / base64 用）
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/**
 * MockDriver — 演示安全网
 * 不依赖任何浏览器/原生库，返回固定语义快照 + 占位 PNG
 */
export class MockDriver implements BrowserDriver {
  private currentUrl = ""

  async launch(options?: LaunchOptions): Promise<void> {
    await delay(50)
    console.log(`[MockDriver] Launched (headless=${options?.headless ?? true})`)
  }

  async navigate(url: string): Promise<void> {
    await delay(50)
    this.currentUrl = url
    console.log(`[MockDriver] Navigated to ${url}`)
  }

  async snapshot(): Promise<SemanticSnapshot> {
    await delay(20)
    return {
      title: `Mock Page — ${extractDomain(this.currentUrl)}`,
      url: this.currentUrl,
      elements: [
        { ref: 0, tag: "h1", role: "heading", text: "Welcome to the Product", selector: '[data-fp-ref="0"]', bounds: { x: 100, y: 80, width: 600, height: 48 } },
        { ref: 1, tag: "h2", role: "heading", text: "Features", selector: '[data-fp-ref="1"]', bounds: { x: 100, y: 200, width: 300, height: 36 } },
        { ref: 2, tag: "button", role: "button", text: "Get Started", selector: '[data-fp-ref="2"]', bounds: { x: 100, y: 300, width: 160, height: 44 } },
        { ref: 3, tag: "a", role: "link", text: "Documentation", selector: '[data-fp-ref="3"]', bounds: { x: 280, y: 300, width: 140, height: 44 } },
      ],
      textContent: "Welcome to the Product\nFeatures\nGet Started\nDocumentation",
    }
  }

  async screenshot(): Promise<Buffer> {
    await delay(30)
    return Buffer.from(TINY_PNG_BASE64, "base64")
  }

  async click(selector: string): Promise<void> {
    await delay(20)
    console.log(`[MockDriver] Clicked: ${selector}`)
  }

  async fill(selector: string, value: string): Promise<void> {
    await delay(20)
    console.log(`[MockDriver] Filled: ${selector} = "${value}"`)
  }

  async scroll(direction: "down" | "up" | "left" | "right"): Promise<void> {
    await delay(20)
    console.log(`[MockDriver] Scrolled ${direction}`)
  }

  async pressKey(key: string): Promise<void> {
    await delay(20)
    console.log(`[MockDriver] Pressed key: ${key}`)
  }

  async getCurrentUrl(): Promise<string> {
    return this.currentUrl
  }

  async waitFor(selector: string, _timeout?: number): Promise<void> {
    await delay(20)
    console.log(`[MockDriver] Waited for: ${selector}`)
  }

  async evaluate<T>(_fn: string | (() => T)): Promise<T> {
    await delay(20)
    // 品牌数据提取在 mock 下无从执行，返回 null → 适配器走下限 tokens
    return null as T
  }

  async close(): Promise<void> {
    await delay(20)
    this.currentUrl = ""
    console.log("[MockDriver] Closed")
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url || "localhost"
  }
}
