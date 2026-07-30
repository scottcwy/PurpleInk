import { basename, extname } from 'node:path'

export const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

export function productionHardLimit(
  path: string
): 300 | 350 | 400 | undefined {
  if (
    !CODE_EXTENSIONS.has(extname(path).toLowerCase())
    || /(?:^|\.)(?:test|spec|demo)\.[^.]+$/iu.test(path)
    || path.endsWith('.d.ts')
    || path.startsWith('docs/')
  ) {
    return undefined
  }
  if (basename(path).toLowerCase() === 'page.tsx') return 300
  if (
    /(?:^|[./-])(?:schema|schemas|repository|repositories)(?:[./-]|$)/iu
      .test(path)
  ) {
    return 400
  }
  return 350
}

export function countLines(text: string): number {
  if (text.length === 0) return 0
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n').length
    : normalized.split('\n').length
}
