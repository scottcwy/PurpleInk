import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { config, proxy } from './proxy'

const VALID_TOKEN = 'a'.repeat(43)

function request(path: string, cookie?: string) {
  const nextRequest = new NextRequest(new URL(path, 'http://localhost:3000'))
  if (cookie !== undefined) nextRequest.cookies.set('cvc_session', cookie)
  return nextRequest
}

describe('proxy guard', () => {
  it('sends anonymous /products traffic to /login with an in-site next target', () => {
    const response = proxy(request('/products/canvas/abc?tab=graph'))

    expect(response.status).toBe(307)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('next')).toBe('/products/canvas/abc?tab=graph')
  })

  it('guards every /products sub-path, including the bare segment', () => {
    for (const path of ['/products', '/products/dashboard', '/products/settings']) {
      expect(proxy(request(path)).headers.get('location')).toContain('/login')
    }
  })

  it('lets a shaped session cookie through without touching the database', () => {
    const response = proxy(request('/products/dashboard', VALID_TOKEN))

    expect(response.headers.get('location')).toBeNull()
  })

  it('treats a malformed cookie as anonymous', () => {
    for (const cookie of ['', 'short', `${VALID_TOKEN}!`, 'a'.repeat(44)]) {
      expect(proxy(request('/products/dashboard', cookie)).headers.get('location')).toContain(
        '/login',
      )
    }
  })

  it('bounces an already-signed-in visitor away from the auth pages', () => {
    for (const path of ['/login', '/signup', '/password/reset']) {
      const location = proxy(request(path, VALID_TOKEN)).headers.get('location')
      expect(location).toContain('/products/dashboard')
    }
  })

  it('leaves the auth pages reachable for anonymous visitors', () => {
    for (const path of ['/login', '/signup', '/password/reset']) {
      expect(proxy(request(path)).headers.get('location')).toBeNull()
    }
  })

  it('does not intercept /api/* — handlers answer 401 there, not 302', () => {
    expect(config.matcher.some((pattern) => pattern.includes('/api'))).toBe(false)
  })

  it('matches exactly the guarded surfaces declared in routing.md §9', () => {
    expect(config.matcher).toEqual([
      '/products/:path*',
      '/login',
      '/signup',
      '/password/reset',
    ])
  })
})
