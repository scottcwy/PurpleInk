import {
  checkSource,
  type DeterminismViolation,
} from '@/lib/determinism'

export type FabricateSourceViolation = DeterminismViolation

export type FabricateSourceInspection =
  | { ok: true; violations: [] }
  | { ok: false; violations: FabricateSourceViolation[] }

const MASTER_VIEWPORT = { width: '1920', height: '1080' } as const

export function inspectFabricateSource(source: string): FabricateSourceInspection {
  const violations: FabricateSourceViolation[] = [...checkSource(source)]
  inspectViewport(source, violations)
  inspectCompositionRoot(source, violations)
  return violations.length === 0
    ? { ok: true, violations: [] }
    : { ok: false, violations }
}

function inspectViewport(
  source: string,
  violations: FabricateSourceViolation[]
): void {
  const tags = source.match(/<meta\b[^>]*>/gi) ?? []
  const viewport = tags.find((tag) => readAttributes(tag).name?.toLowerCase() === 'viewport')
  const line = lineOf(source, viewport ? source.indexOf(viewport) : 0)
  const content = viewport ? readAttributes(viewport).content ?? '' : ''
  for (const [dimension, expected] of Object.entries(MASTER_VIEWPORT)) {
    const pattern = new RegExp(`(?:^|[,;\\s])${dimension}\\s*=\\s*${expected}(?:[,;\\s]|$)`, 'i')
    if (!pattern.test(content)) {
      violations.push({
        ruleId: `viewport-${dimension}`,
        line,
        message: `viewport 必须声明 ${dimension}=${expected}`,
        snippet: viewport ?? '',
      })
    }
  }
}

function inspectCompositionRoot(
  source: string,
  violations: FabricateSourceViolation[]
): void {
  const tags = source.match(/<(?!\/|!)[a-z][^>]*>/gi) ?? []
  const roots = tags.filter((tag) => readAttributes(tag)['data-composition-id'])
  if (roots.length !== 1) {
    violations.push({
      ruleId: 'composition-root-count',
      line: lineOf(source, roots[0] ? source.indexOf(roots[0]) : 0),
      message: `必须且只能有一个 data-composition-id 根画布，当前为 ${roots.length} 个`,
      snippet: roots[0] ?? '',
    })
    return
  }
  const root = roots[0]!
  const attributes = readAttributes(root)
  const line = lineOf(source, source.indexOf(root))
  for (const [dimension, expected] of Object.entries(MASTER_VIEWPORT)) {
    const attribute = `data-${dimension}`
    if (attributes[attribute] !== expected) {
      violations.push({
        ruleId: `composition-${dimension}`,
        line,
        message: `根画布 ${attribute} 必须为 "${expected}"`,
        snippet: root,
      })
    }
  }
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes[match[1]!.toLowerCase()] = match[3]!
  }
  return attributes
}

function lineOf(source: string, index: number): number {
  return source.slice(0, Math.max(0, index)).split('\n').length
}
