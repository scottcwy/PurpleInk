import { extname } from 'node:path'
import ts from 'typescript'
import { CODE_EXTENSIONS } from './architecture-file-limits'

const EXPLICIT_PATTERNS = [
  { pattern: /\bduration-\d+\b/gu, specifier: (value: string) => value },
  { pattern: /cubic-bezier\s*\(/giu, specifier: normalizeMatch },
  { pattern: /\btransition-all\b/gu, specifier: normalizeMatch },
  { pattern: /\bease-\[/gu, specifier: normalizeMatch },
] as const

const PROPERTY_TRANSITION =
  /\btransition-(?:colors|opacity|transform|shadow|\[[^\]\s]+\])(?=\s|$)/gu
const DURATION_CLASS = /\bduration-[^\s"'`]+/u

export interface MotionLiteralFinding {
  ruleId: 'MOTION_LITERAL'
  path: string
  specifier: string
  line: number
}

interface TextFragment {
  text: string
  line: number
}

function normalizeMatch(value: string): string {
  return value.replaceAll(/\s/gu, '')
}

export function findMotionLiterals(
  path: string,
  text: string
): MotionLiteralFinding[] {
  if (!isMotionLiteralProductionFile(path)) return []

  const kind = path.toLowerCase().endsWith('x')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind
  )
  const findings: MotionLiteralFinding[] = []

  const visitExplicit = (node: ts.Node): void => {
    const fragment = textFragment(source, node)
    if (fragment) {
      for (const { pattern, specifier } of EXPLICIT_PATTERNS) {
        for (const match of fragment.text.matchAll(pattern)) {
          findings.push({
            ruleId: 'MOTION_LITERAL',
            path,
            specifier: specifier(match[0]),
            line: fragment.line,
          })
        }
      }
    }
    ts.forEachChild(node, visitExplicit)
  }
  visitExplicit(source)

  const visitClassNames = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node)
      && node.name.getText(source) === 'className'
      && node.initializer
    ) {
      const fragments = collectTextFragments(source, node.initializer)
      const classText = fragments.map(({ text }) => text).join(' ')
      if (!DURATION_CLASS.test(classText)) {
        for (const fragment of fragments) {
          for (const match of fragment.text.matchAll(PROPERTY_TRANSITION)) {
            findings.push({
              ruleId: 'MOTION_LITERAL',
              path,
              specifier: match[0],
              line: fragment.line,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visitClassNames)
  }
  visitClassNames(source)

  return deduplicate(findings)
}

function isMotionLiteralProductionFile(path: string): boolean {
  const lower = path.toLowerCase()
  return (
    CODE_EXTENSIONS.has(extname(lower))
    && !lower.startsWith('docs/')
    && !/(?:^|\.)(?:test|spec|demo)\.[^.]+$/iu.test(lower)
    && !lower.startsWith('src/features/render/__fixtures__/')
  )
}

function collectTextFragments(
  source: ts.SourceFile,
  root: ts.Node
): TextFragment[] {
  const fragments: TextFragment[] = []
  const visit = (node: ts.Node): void => {
    const fragment = textFragment(source, node)
    if (fragment) fragments.push(fragment)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return fragments
}

function textFragment(
  source: ts.SourceFile,
  node: ts.Node
): TextFragment | undefined {
  if (!ts.isStringLiteralLike(node) && !ts.isTemplateLiteralToken(node)) {
    return undefined
  }
  return {
    text: node.text,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  }
}

function deduplicate(
  findings: MotionLiteralFinding[]
): MotionLiteralFinding[] {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.path}:${finding.line}:${finding.specifier}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
