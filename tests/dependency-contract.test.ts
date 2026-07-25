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
