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
  inspectEmbeddedFonts(source, violations)
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

const FONT_SIGNATURES: Record<string, readonly string[]> = {
  'font/woff2': ['d09GMg'],
  'font/woff': ['d09GRg'],
  'font/ttf': ['AAEAAA', 'dHJ1ZQ'],
  'font/otf': ['T1RUTw'],
  'application/font-woff': ['d09GRg'],
  'application/font-sfnt': ['AAEAAA', 'dHJ1ZQ', 'T1RUTw'],
  'application/x-font-ttf': ['AAEAAA', 'dHJ1ZQ'],
  'application/x-font-opentype': ['T1RUTw'],
}

function inspectEmbeddedFonts(
  source: string,
  violations: FabricateSourceViolation[],
): void {
  for (const face of source.matchAll(/@font-face\s*\{[\s\S]*?\}/giu)) {
    const block = face[0]
    if (!block.includes('data:')) continue
    const dataUrls = [
      ...block.matchAll(/url\(\s*(['"]?)data:([^,]+),([\s\S]*?)\1\s*\)/giu),
    ]
    const line = lineOf(source, face.index ?? 0)
    if (dataUrls.length === 0) {
      violations.push(fontViolation(
        'font-data-url',
        line,
        '内联字体 data URL 结构无效',
        block,
      ))
      continue
    }
    for (const dataUrl of dataUrls) {
      const [mime = '', ...parameters] = dataUrl[2]!
        .split(';')
        .map((part) => part.trim().toLowerCase())
      const signatures = FONT_SIGNATURES[mime]
      if (!signatures) {
        violations.push(fontViolation(
          'font-data-mime',
          line,
          `不支持的内联字体 MIME：${mime || 'missing'}`,
          block,
        ))
        continue
      }
      if (!parameters.includes('base64')) {
        violations.push(fontViolation(
          'font-data-base64',
          line,
          '内联字体必须使用合法 Base64 编码',
          block,
        ))
        continue
      }
      const payload = dataUrl[3]!.replace(/\s+/gu, '')
      if (!isStrictBase64(payload)) {
        violations.push(fontViolation(
          'font-data-base64',
          line,
          '内联字体必须使用合法 Base64 编码',
          block,
        ))
        continue
      }
      if (!signatures.some((signature) => payload.startsWith(signature))) {
        violations.push(fontViolation(
          'font-data-signature',
          line,
          '内联字体 MIME 与文件签名不匹配',
          block,
        ))
      }
    }
  }
}

function isStrictBase64(value: string): boolean {
  return value.length >= 8
    && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
}

function fontViolation(
  ruleId: string,
  line: number,
  message: string,
  block: string,
): FabricateSourceViolation {
  return {
    ruleId,
    line,
    message,
    snippet: block.trim().slice(0, 120),
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
