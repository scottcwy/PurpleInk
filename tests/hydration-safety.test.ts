import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveHydratedThemeMode } from '@/lib/hooks/use-theme-mode'

const ROOT = process.cwd()
const SOURCE_ROOT = join(ROOT, 'src')
const SHARED_THEME_HOOK = 'src/lib/hooks/use-theme-mode.ts'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

function clientSources(): Array<{ path: string; source: string }> {
  return sourceFiles(SOURCE_ROOT)
    .map((path) => ({
      path: relative(ROOT, path).replaceAll('\\', '/'),
      source: readFileSync(path, 'utf8'),
    }))
    .filter(({ source }) => /^['"]use client['"]/.test(source))
}

describe('hydration safety', () => {
  it('keeps next-themes browser state behind the shared hydration snapshot', () => {
    const offenders = clientSources()
      .filter(({ path }) => path !== SHARED_THEME_HOOK)
      .filter(({ source }) => /import\s*\{[^}]*\buseTheme\b[^}]*\}\s*from\s*['"]next-themes['"]/.test(source))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
    expect(resolveHydratedThemeMode('dark', false)).toBe('system')
    expect(resolveHydratedThemeMode('dark', true)).toBe('dark')
  })

  it('rejects variable clock state during SSR and hydration', () => {
    const offenders = clientSources()
      .filter(({ source }) =>
        /useState\s*\(\s*(?:\(\)\s*=>\s*)?(?:Date\.now\(\)|Math\.random\(\)|new Date\(\))/.test(source),
      )
      .map(({ path }) => path)
    const implicitDateOffenders = clientSources()
      .filter(({ source }) => /new Date\(\)/.test(source))
      .map(({ path }) => path)

    expect(offenders).toEqual([])
    expect(implicitDateOffenders).toEqual([])
  })

  it('requires an explicit time zone for client-rendered date text', () => {
    const localeOffenders = clientSources()
      .filter(({ source }) => /\.toLocale(?:String|DateString|TimeString)\s*\(/.test(source))
      .map(({ path }) => path)
    const formatterOffenders = clientSources()
      .filter(({ source }) => /new Intl\.DateTimeFormat\([^)]*,\s*\{/.test(source))
      .filter(({ source }) => !/\btimeZone\s*[:,]/.test(source))
      .map(({ path }) => path)

    expect(localeOffenders).toEqual([])
    expect(formatterOffenders).toEqual([])
  })
})
