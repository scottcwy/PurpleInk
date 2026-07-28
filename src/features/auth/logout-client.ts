/**
 * 登出动作（客户端业务函数）。
 *
 * 放 features 而不是 components/ui：设计系统原语只接回调，不 import API。
 * 成功后必须**整页导航**到 /login 而非 router.push——Next 客户端 Router Cache
 * 里还缓存着受保护页面的 RSC payload，软导航会展示"看似仍登录"的缓存页；
 * 整页加载天然清空。失败时不跳转：cookie 仍有效，去 /login 只会被查库守卫
 * 弹回 dashboard，比留在原地提示重试更困惑。
 */
export async function performLogout(
  fetcher: typeof fetch = fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<boolean> {
  const response = await fetcher('/api/auth/logout', { method: 'POST' }).catch(
    () => null,
  )
  if (!response?.ok) return false
  navigate('/login')
  return true
}
