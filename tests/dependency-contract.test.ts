import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>
}

describe('root script dependency contract', () => {
  it('declares @next/env as a production dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as PackageManifest

    expect(packageJson.dependencies).toHaveProperty('@next/env')
  })
})

describe('production browser runtime contract', () => {
  it('traces the complete Playwright runtime into the Next standalone image', async () => {
    const { default: nextConfig } = await import('../next.config')
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as PackageManifest

    expect(packageJson.dependencies?.['playwright-core']).toBe('1.62.0')
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(['playwright', 'playwright-core']),
    )
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      '/*': [
        './node_modules/playwright/**/*',
        './node_modules/playwright-core/**/*',
      ],
    })
  })

  it('installs the matching Playwright Chromium runtime in the web image', () => {
    const dockerfile = readFileSync(
      resolve(process.cwd(), 'Dockerfile.web'),
      'utf8',
    )

    expect(dockerfile).toContain('ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright')
    expect(dockerfile).toContain(
      'npx --yes playwright@1.62.0 install --with-deps chromium',
    )
  })

  it('points HyperFrames at the worker headless shell installed by Playwright', () => {
    const dockerfile = readFileSync(
      resolve(process.cwd(), 'Dockerfile.worker'),
      'utf8',
    )

    expect(dockerfile).toContain(
      'ENV HYPERFRAMES_BROWSER_PATH=/usr/local/bin/purpleink-chrome-headless-shell',
    )
    expect(dockerfile).toContain(
      '/ms-playwright/chromium_headless_shell-',
    )
  })
})
