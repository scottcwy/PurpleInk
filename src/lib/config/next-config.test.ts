import { describe, expect, it } from 'vitest'
import nextConfig from '../../../next.config'

describe('Next server dependency boundaries', () => {
  it('keeps the platform ffmpeg binary path outside the Turbopack bundle', () => {
    expect(nextConfig.serverExternalPackages).toContain('ffmpeg-static')
  })

  it('keeps the Postgres transaction driver outside the Turbopack bundle', () => {
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(['postgres', 'drizzle-orm']),
    )
  })
})
