import type { BrowserContext } from "playwright"
import { validatePublicUrl } from "../security/public-url-policy"

/**
 * 仅 integrated/public capture 启用。每个 HTTP(S) 请求都重新执行 DNS 公网门禁，
 * redirect、点击导航与页面子资源不会绕过入口检查。
 */
export async function installPublicRequestGuard(
  context: BrowserContext
): Promise<void> {
  await context.route("**/*", async (route) => {
    const target = route.request().url()
    if (!/^https?:/i.test(target)) {
      await route.continue()
      return
    }
    try {
      await validatePublicUrl(target)
      await route.continue()
    } catch {
      console.warn("[PlaywrightDriver] Blocked a non-public request")
      await route.abort("blockedbyclient").catch(() => {})
    }
  })
}
