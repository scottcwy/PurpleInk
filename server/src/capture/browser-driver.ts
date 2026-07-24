// 从 Firenze frameproof/src/lib/agents/browser-driver.ts 移植（改导入路径、去 @ 别名）。
import type { LaunchOptions, SemanticSnapshot } from "../types/capture"

/**
 * BrowserDriver — 浏览器自动化核心抽象
 * 所有驱动（Playwright / Mock）均实现此接口
 */
export interface BrowserDriver {
  /** 启动浏览器实例 */
  launch(options?: LaunchOptions): Promise<void>
  /** 导航到指定 URL */
  navigate(url: string): Promise<void>
  /** 获取当前页面的语义快照 */
  snapshot(): Promise<SemanticSnapshot>
  /** 截取当前页面截图 */
  screenshot(): Promise<Buffer>
  /** ④ 元素级紧裁截图：把某个内容容器单独截出(scrollIntoView + 等可见)；太小/失败返回 null */
  screenshotElement?(selector: string): Promise<Buffer | null>
  /** ④ 截图前静置：等字体/入场动画/懒加载(marquee 等异步组件)渲染完，避免截到空白 */
  settle?(ms?: number): Promise<void>
  /** 点击元素 */
  click(selector: string): Promise<void>
  /** 填充表单字段 */
  fill(selector: string, value: string): Promise<void>
  /** 页面滚动 */
  scroll(direction: "down" | "up" | "left" | "right"): Promise<void>
  /** 按下键盘按键（如 Enter、Tab），用于提交表单等 */
  pressKey(key: string): Promise<void>
  /** 获取当前页面 URL */
  getCurrentUrl(): Promise<string>
  /** 等待元素出现 */
  waitFor(selector: string, timeout?: number): Promise<void>
  /** 在页面上下文中执行脚本（用于品牌数据提取 extractPageTokensInBrowser） */
  evaluate<T>(fn: string | (() => T)): Promise<T>
  /** 关闭浏览器 */
  close(): Promise<void>
}

/** 驱动类型 */
export type DriverType = "playwright" | "mock"

/**
 * 工厂函数 — 根据环境变量 BROWSER_DRIVER 选择驱动实现。
 * 默认 playwright（真实采集）；mock 用于无浏览器的链路冒烟。
 */
export async function createDriver(type?: DriverType): Promise<BrowserDriver> {
  const driverType = type ?? (process.env.BROWSER_DRIVER as DriverType) ?? "playwright"

  switch (driverType) {
    case "playwright": {
      const { PlaywrightDriver } = await import("./playwright-driver")
      return new PlaywrightDriver()
    }
    case "mock": {
      const { MockDriver } = await import("./mock-driver")
      return new MockDriver()
    }
    default:
      throw new Error(`Unknown driver type: ${driverType}`)
  }
}
