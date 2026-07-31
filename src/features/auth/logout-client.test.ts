import { describe, expect, it, vi } from 'vitest'
import { performLogout } from './logout-client'

describe('performLogout', () => {
  it('posts to /api/auth/logout and hard-navigates to /login on success', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    const navigate = vi.fn()

    await expect(performLogout(fetcher, navigate)).resolves.toBe(true)

    expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' })
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  it('reports failure without navigating when the server rejects', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 500 }))
    const navigate = vi.fn()

    await expect(performLogout(fetcher, navigate)).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('reports failure without navigating when the network throws', async () => {
    // 登出失败时绝不能跳 /login：cookie 仍有效，会被查库守卫弹回 dashboard，
    // 用户会以为"退出了又自动登录"。留在原地由按钮文本提示重试。
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const navigate = vi.fn()

    await expect(performLogout(fetcher, navigate)).resolves.toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})
