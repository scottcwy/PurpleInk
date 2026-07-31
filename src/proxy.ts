import { NextResponse, type NextRequest } from 'next/server'

/**
 * 入站路由守卫（Next 16 用 `proxy.ts` 取代 `middleware.ts`，AGENTS.md §5）。
 *
 * 职责刻意很窄——**只做 cookie 存在性与形状的廉价判断，不查数据库**。
 * proxy 跑在每个匹配请求上，连库会成为全站延迟与 Postgres 连接数压力
 * （`postgres.js` 没传连接上限参数）。真正的会话校验在 layout / handler 里做：
 * `src/features/auth/page-session.ts` 与 `api-session.ts`。
 *
 * 因此「proxy 放行」只意味着「带了一个形状合法的 cookie」，不意味着已登录；
 * 这是有意的分层，`docs/conventions/routing.md` §9 按此口径记录。
 *
 * 同理，认证页（/login 等）**不能**在这里按 cookie 形状弹回 /products：
 * 形状合法但 DB 已失效的残留 cookie（改密码 revoke、会话过期被清理等）
 * 会与页面级 `requireSession` 的 302 /login 形成无限重定向循环。
 * 「已登录访问认证页 → 302」由各页的 `redirectIfAuthenticated`（查库）负责。
 *
 * `/api/*` 不在 matcher 里：API 需要 401 / 404 语义而不是 302，每个 handler
 * 自己校验（§3.3）。
 */
const SESSION_COOKIE_NAME = 'cvc_session'
/** cookie 明文是 32 字节 base64url，长度恒为 43。 */
const SESSION_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl
  const hasSessionCookie = SESSION_TOKEN_SHAPE.test(
    request.cookies.get(SESSION_COOKIE_NAME)?.value ?? '',
  )

  if (pathname.startsWith('/products')) {
    if (hasSessionCookie) return NextResponse.next()
    const target = new URL('/login', request.nextUrl)
    target.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(target)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/products/:path*'],
}
