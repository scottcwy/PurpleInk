import { existsSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const ROOT = resolve(import.meta.dirname, '../..')
const DEFAULT_BASELINE = resolve(ROOT, 'scripts/verify/v3-architecture-baseline.json')
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const EXCLUDED_DIRECTORIES = new Set([
  '.agents', '.codex', '.data', '.git', '.next', '.qoder', '.trigger',
  'coverage', 'dist', 'node_modules', 'out', 'output',
])
const SCAN_DIRECTORIES = new Set(['docs', 'packages', 'scripts', 'src', 'trigger'])
const DEBT_CATEGORIES = [
  'directOpenAiClientImports', 'canvasForbiddenImports', 'triggerTaskForbiddenImports',
] as const
type DebtCategory = (typeof DEBT_CATEGORIES)[number]
type ImportRule =
  | 'AGENTS_SDK_PACKAGE' | 'AGENTS_SDK_IMPORT' | 'DIRECT_OPENAI_CLIENT_IMPORT'
  | 'CANVAS_FORBIDDEN_IMPORT' | 'TRIGGER_TASK_FORBIDDEN_IMPORT'
export interface ArchitectureFinding {
  ruleId: ImportRule; path: string; specifier: string; line?: number
}
export interface ReplacementCharacterFinding {
  ruleId: 'UTF8_REPLACEMENT_CHARACTER'; path: string; line: number; column: number
}
export interface OversizedFile {
  lineCount: number; hardLimit: 300 | 350 | 400
}
export interface V3ArchitectureReport {
  schemaVersion: 1; scannedFiles: number
  agentsSdkPackages: ArchitectureFinding[]; agentsSdkImports: ArchitectureFinding[]
  directOpenAiClientImports: ArchitectureFinding[]; canvasForbiddenImports: ArchitectureFinding[]
  triggerTaskForbiddenImports: ArchitectureFinding[]
  replacementCharacters: ReplacementCharacterFinding[]; oversizedFiles: Record<string, OversizedFile>
}
export interface V3ArchitectureBaseline {
  schemaVersion: 1; debtCaps: Record<DebtCategory, number>
  oversizedFiles: Record<string, OversizedFile>
}
type V3ArchitectureViolation =
  | ArchitectureFinding | ReplacementCharacterFinding
  | { ruleId: 'DEBT_CAP_EXCEEDED'; category: DebtCategory; cap: number; actual: number }
  | { ruleId: 'OVERSIZED_NEW_FILE'; path: string; actualLines: number; hardLimit: 300 | 350 | 400 }
  | { ruleId: 'OVERSIZED_FILE_GROWTH'; path: string; baselineLines: number
      actualLines: number; hardLimit: 300 | 350 | 400 }
export interface ScanV3ArchitectureOptions {
  rootDir: string; readTextFile?: (path: string) => string
}
interface ModuleReference { specifier: string; line: number }
export function scanV3Architecture(options: ScanV3ArchitectureOptions): V3ArchitectureReport {
  const rootDir = resolve(options.rootDir)
  const readTextFile =
    options.readTextFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const report = emptyReport()
  for (const absolutePath of collectTextFiles(rootDir)) {
    const path = toPosix(relative(rootDir, absolutePath))
    const text = readTextFile(absolutePath)
    report.scannedFiles += 1
    report.agentsSdkPackages.push(...findAgentsPackages(path, text))
    report.replacementCharacters.push(...findReplacementCharacters(path, text))
    if (!CODE_EXTENSIONS.has(extname(path).toLowerCase())) continue
    inspectModules(report, path, text)
    const hardLimit = productionHardLimit(path)
    const lineCount = countLines(text)
    if (hardLimit && lineCount > hardLimit) {
      report.oversizedFiles[path] = { lineCount, hardLimit }
    }
  }
  sortReport(report)
  return report
}
export function createV3ArchitectureBaseline(report: V3ArchitectureReport): V3ArchitectureBaseline {
  return {
    schemaVersion: 1,
    debtCaps: {
      directOpenAiClientImports: report.directOpenAiClientImports.length,
      canvasForbiddenImports: report.canvasForbiddenImports.length,
      triggerTaskForbiddenImports: report.triggerTaskForbiddenImports.length,
    },
    oversizedFiles: Object.fromEntries(
      Object.entries(report.oversizedFiles).map(([path, value]) => [
        path, { ...value },
      ])
    ),
  }
}
export function checkV3Architecture(report: V3ArchitectureReport, baseline: V3ArchitectureBaseline): V3ArchitectureViolation[] {
  if (baseline.schemaVersion !== 1) throw new Error('不支持的 baseline schemaVersion')
  const violations: V3ArchitectureViolation[] = [
    ...report.agentsSdkPackages, ...report.agentsSdkImports,
    ...report.replacementCharacters,
  ]
  for (const category of DEBT_CATEGORIES) {
    const actual = report[category].length
    const cap = baseline.debtCaps[category]
    if (actual > cap) {
      violations.push({ ruleId: 'DEBT_CAP_EXCEEDED', category, cap, actual })
    }
  }
  for (const [path, current] of Object.entries(report.oversizedFiles)) {
    const previous = baseline.oversizedFiles[path]
    if (!previous) {
      violations.push({
        ruleId: 'OVERSIZED_NEW_FILE', path,
        actualLines: current.lineCount, hardLimit: current.hardLimit,
      })
    } else if (current.lineCount > previous.lineCount) {
      violations.push({
        ruleId: 'OVERSIZED_FILE_GROWTH', path,
        baselineLines: previous.lineCount, actualLines: current.lineCount,
        hardLimit: current.hardLimit,
      })
    }
  }
  return violations
}
export function writeV3ArchitectureBaseline(path: string, baseline: V3ArchitectureBaseline): void {
  const target = resolve(path)
  if (existsSync(target)) throw new Error(`baseline 已存在: ${basename(target)}`)
  const temporary = resolve(
    dirname(target), `.${basename(target)}.${process.pid}.${Date.now()}.tmp`
  )
  try {
    writeFileSync(temporary, `${JSON.stringify(baseline, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx',
    })
    if (existsSync(target)) throw new Error(`baseline 已存在: ${basename(target)}`)
    renameSync(temporary, target)
  } finally {
    if (existsSync(temporary)) rmSync(temporary)
  }
}
function emptyReport(): V3ArchitectureReport {
  return {
    schemaVersion: 1, scannedFiles: 0, agentsSdkPackages: [],
    agentsSdkImports: [], directOpenAiClientImports: [],
    canvasForbiddenImports: [], triggerTaskForbiddenImports: [],
    replacementCharacters: [], oversizedFiles: {},
  }
}
function collectTextFiles(rootDir: string): string[] {
  const files: string[] = []
  function visit(directory: string, root = false): void {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase()
        if (!EXCLUDED_DIRECTORIES.has(name) && (!root || SCAN_DIRECTORIES.has(name))) visit(absolutePath)
      } else if (shouldReadFile(entry.name)) files.push(absolutePath)
    }
  }
  visit(rootDir, true)
  return files
}
function shouldReadFile(name: string): boolean {
  const lower = name.toLowerCase()
  return CODE_EXTENSIONS.has(extname(lower)) || lower.endsWith('.md') ||
    lower === 'package.json' || lower === 'pnpm-lock.yaml'
}
function findAgentsPackages(path: string, text: string): ArchitectureFinding[] {
  let specifiers: string[] = []
  if (basename(path).toLowerCase() === 'package.json') {
    const manifest = JSON.parse(text) as Record<string, unknown>
    const groups = [manifest.dependencies, manifest.devDependencies,
      manifest.optionalDependencies, manifest.peerDependencies].filter(isRecord)
    specifiers = groups.flatMap((group) => Object.keys(group))
    specifiers.push(...(JSON.stringify(groups).match(/(?<=npm:)@openai\/agents(?:-[a-z0-9._-]+)?(?=@|["'\s,}]|$)/gi) ?? []))
  } else if (basename(path).toLowerCase() === 'pnpm-lock.yaml') {
    specifiers =
      text.match(/@openai\/agents(?:-[a-z0-9._-]+)?(?=@|\/|:|\s|['"]|$)/gi) ?? []
  }
  return [...new Set(specifiers)].filter(isOpenAiAgentsSpecifier)
    .map((specifier) => ({ ruleId: 'AGENTS_SDK_PACKAGE', path, specifier }))
}
export function isOpenAiAgentsSpecifier(specifier: string): boolean {
  return specifier === '@openai/agents' ||
    specifier.startsWith('@openai/agents/') ||
    specifier.startsWith('@openai/agents-')
}
function inspectModules(report: V3ArchitectureReport, path: string, text: string): void {
  for (const reference of moduleReferences(path, text)) {
    const finding = { path, ...reference }
    if (isOpenAiAgentsSpecifier(reference.specifier)) {
      report.agentsSdkImports.push({ ruleId: 'AGENTS_SDK_IMPORT', ...finding })
    }
    if (isDirectOpenAiSpecifier(reference.specifier)) {
      report.directOpenAiClientImports.push({
        ruleId: 'DIRECT_OPENAI_CLIENT_IMPORT', ...finding,
      })
    }
    if (path.startsWith('src/features/canvas/') &&
        isCanvasForbidden(reference.specifier)) {
      report.canvasForbiddenImports.push({
        ruleId: 'CANVAS_FORBIDDEN_IMPORT', ...finding,
      })
    }
    if (path.startsWith('trigger/tasks/') &&
        isDatabaseSpecifier(reference.specifier)) {
      report.triggerTaskForbiddenImports.push({
        ruleId: 'TRIGGER_TASK_FORBIDDEN_IMPORT', ...finding,
      })
    }
  }
}
function moduleReferences(path: string, text: string): ModuleReference[] {
  const kind = path.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const references: ModuleReference[] = []
  const add = (node: ts.StringLiteralLike): void => {
    references.push({
      specifier: node.text,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    })
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add(node.moduleSpecifier)
    } else if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)) {
      add(node.moduleReference.expression)
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const first = node.arguments[0]
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const requireCall =
        ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if ((dynamicImport || requireCall) && ts.isStringLiteralLike(first)) add(first)
      else if (dynamicImport || requireCall) references.push({
        specifier: '<non-literal-module>',
        line: source.getLineAndCharacterOfPosition(first.getStart(source)).line + 1,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return references
}
function isDirectOpenAiSpecifier(specifier: string): boolean {
  return specifier === 'openai' || specifier.startsWith('openai/')
}
function isCanvasForbidden(specifier: string): boolean {
  return isDatabaseSpecifier(specifier) ||
    specifier.startsWith('@trigger.dev/') || /(?:^|[/.-])trigger(?:$|[/.-])/i.test(specifier) ||
    specifier.startsWith('@earendil-works/pi-') ||
    specifier === 'hyperframes' || specifier.includes('/hyperframes') ||
    specifier.includes('/pi-')
}
function isDatabaseSpecifier(specifier: string): boolean {
  return specifier === '<non-literal-module>' ||
    specifier === 'drizzle-orm' || specifier.startsWith('drizzle-orm/') ||
    /(?:^|\/)(?:lib|server)\/db(?:\/|$)/.test(specifier) ||
    /(?:^|\/)(?:db|database)\/(?:client|migrate|schema)(?:\/|$)/.test(specifier)
}
function findReplacementCharacters(
  path: string, text: string
): ReplacementCharacterFinding[] {
  const findings: ReplacementCharacterFinding[] = []
  for (let index = text.indexOf('\uFFFD'); index >= 0;
    index = text.indexOf('\uFFFD', index + 1)) {
    const before = text.slice(0, index)
    const lastBreak = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'))
    findings.push({
      ruleId: 'UTF8_REPLACEMENT_CHARACTER', path,
      line: before.split(/\r\n|\r|\n/).length, column: index - lastBreak,
    })
  }
  return findings
}
function productionHardLimit(path: string): 300 | 350 | 400 | undefined {
  if (!CODE_EXTENSIONS.has(extname(path).toLowerCase()) ||
      /(?:^|\.)(?:test|spec|demo)\.[^.]+$/i.test(path) ||
      path.endsWith('.d.ts') || path.startsWith('docs/')) return undefined
  if (basename(path).toLowerCase() === 'page.tsx') return 300
  if (/(?:^|[./-])(?:schema|schemas|repository|repositories)(?:[./-]|$)/i
    .test(path)) return 400
  return 350
}
function countLines(text: string): number {
  if (text.length === 0) return 0
  const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  return normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n').length : normalized.split('\n').length
}
function sortReport(report: V3ArchitectureReport): void {
  const compare = (
    left: ArchitectureFinding | ReplacementCharacterFinding,
    right: ArchitectureFinding | ReplacementCharacterFinding
  ): number => left.path.localeCompare(right.path, 'en') ||
    (left.line ?? 0) - (right.line ?? 0) ||
    ('specifier' in left ? left.specifier : '').localeCompare(
      'specifier' in right ? right.specifier : '', 'en'
    )
  report.agentsSdkPackages.sort(compare)
  report.agentsSdkImports.sort(compare)
  report.directOpenAiClientImports.sort(compare)
  report.canvasForbiddenImports.sort(compare)
  report.triggerTaskForbiddenImports.sort(compare)
  report.replacementCharacters.sort(compare)
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function readBaseline(path: string): V3ArchitectureBaseline {
  if (!existsSync(path)) throw new Error(`baseline 不存在: ${basename(path)}`)
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const caps = isRecord(value) ? value.debtCaps : undefined
  const oversized = isRecord(value) ? value.oversizedFiles : undefined
  const validCaps = isRecord(caps) && DEBT_CATEGORIES.every(
    (category) => Number.isInteger(caps[category]) && Number(caps[category]) >= 0
  )
  const validOversized = isRecord(oversized) && Object.values(oversized).every(
    (entry) => isRecord(entry) && Number.isInteger(entry.lineCount) &&
      [300, 350, 400].includes(Number(entry.hardLimit))
  )
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      !validCaps || !validOversized) throw new Error('architecture baseline 无效')
  return value as unknown as V3ArchitectureBaseline
}
function toPosix(path: string): string {
  return path.replaceAll('\\', '/')
}
function runCli(args: readonly string[]): void {
  const report = scanV3Architecture({ rootDir: ROOT })
  if (args.length === 1 && args[0] === '--report') {
    console.log(JSON.stringify(report, null, 2))
  } else if (args.length === 2 && args[0] === '--write-baseline') {
    const target = resolve(ROOT, args[1])
    writeV3ArchitectureBaseline(target, createV3ArchitectureBaseline(report))
    console.log(`Baseline written: ${toPosix(relative(ROOT, target))}`)
  } else if (args.length === 1 && args[0] === '--check') {
    const violations = checkV3Architecture(report, readBaseline(DEFAULT_BASELINE))
    console.log(JSON.stringify({ ok: violations.length === 0, violations, report }, null, 2))
    if (violations.length > 0) process.exitCode = 1
  } else {
    throw new Error('用法: --check | --report | --write-baseline <path>')
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2))
  } catch {
    console.error('v3 architecture command failed')
    process.exitCode = 1
  }
}
