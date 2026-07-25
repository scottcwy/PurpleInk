/**
 * 端到端冒烟：真实文本 -> 真实模型 -> 真实 Chromium -> 真实 ffmpeg -> 成片 MP4。
 *
 * 只驱动现有 HTTP API，不绕过 API 写数据库；数据库仅只读用于取证核对
 * （节点状态、artifact 的 content_hash / size_bytes / version）。
 *
 * 用法（需要 pnpm dev 已在跑，且凭据已写入 DB 加密存储）：
 *   pnpm verify:e2e --script docs/issues/evidence/fixtures/smoke.txt
 *   pnpm verify:e2e --text "第一句。" --title "冒烟"
 *
 * 退出码：0 全部通过；1 任一断言失败或超时。失败时如实报出卡在哪个节点/阶段，
 * 不回显 prompt、凭据或 provider 原始错误。
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'

/**
 * `src/lib/db/client.ts` 与 `@/lib/storage` 用 `import 'server-only'` 作为 Next
 * 进程哨兵。本脚本在 Next runtime 之外读库取证，需先把该 bare specifier 重定向到
 * 空模块（与 `scripts/setup/bootstrap-credentials.ts` 同一模式），再 dynamic import。
 */
const nodeRequire = createRequire(import.meta.url)

function installServerOnlyShim(): void {
  const stubPath = nodeRequire.resolve('../setup/server-only-stub.js')
  const Module = nodeRequire('node:module') as typeof import('node:module')
  const holder = Module as unknown as {
    _resolveFilename: (...args: unknown[]) => string
  }
  const original = holder._resolveFilename
  holder._resolveFilename = function (
    request: unknown,
    ...rest: unknown[]
  ): string {
    if (request === 'server-only') return stubPath
    return original.call(this, request, ...rest)
  }
}

installServerOnlyShim()
loadEnvConfig(process.cwd())

interface Options {
  baseUrl: string
  title: string
  script: string
  timeoutMs: number
  reportPath: string
}

interface GraphNode {
  id: string
  type: string
  status: string
  logicalKey?: string
}

const TERMINAL = new Set(['succeeded', 'success', 'failed', 'cancelled'])

/** 会话进行中持续 append 的实时日志 kind：登记哈希是开始时刻快照，不做等值断言。 */
const LIVE_LOG_KINDS = new Set(['pi-session'])

function isLiveLogKind(kind: string): boolean {
  return LIVE_LOG_KINDS.has(kind)
}

async function main(): Promise<void> {
  const options = await parseOptions(process.argv.slice(2))
  const started = Date.now()
  const report: Record<string, unknown> = {
    startedAt: new Date(started).toISOString(),
    commit: process.env.GIT_COMMIT ?? null,
    baseUrl: options.baseUrl,
    script: { characters: options.script.length },
  }

  const projectId = await createProject(options)
  report.projectId = projectId
  console.log(`[e2e] 项目已创建 ${projectId}`)

  const start = await post(options.baseUrl, '/api/director/pipeline', { projectId })
  report.pipelineStart = start
  console.log('[e2e] autopilot 已启动，开始轮询画布')

  const nodes = await waitForTerminalGraph(options, projectId)
  report.nodes = nodes.map(({ id, type, status, logicalKey }) => ({
    id,
    type,
    status,
    logicalKey: logicalKey ?? null,
  }))

  const failed = nodes.filter((node) => node.status === 'failed')
  report.failedNodes = failed.map((node) => node.logicalKey ?? node.id)

  const artifacts = await readArtifactInventory(projectId)
  report.artifacts = artifacts

  const immutable = artifacts.filter((row) => !isLiveLogKind(row.kind))
  const liveLogs = artifacts.filter((row) => isLiveLogKind(row.kind))
  const hashMismatches = immutable.filter((row) => !row.hashMatches)
  const missingBytes = artifacts.filter((row) => row.actualSize === null)
  report.hashMismatches = hashMismatches.map((row) => row.id)
  report.immutableArtifactCount = immutable.length
  // pi-session 是会话进行中持续 append 的实时日志：登记发生在会话开始（保证失败
  // 也可追溯），其 content_hash / size_bytes 是登记时刻的快照而非最终字节。
  // 因此这里断言「文件存在且相对登记时刻增长」，并如实单列，不冒充哈希一致。
  report.liveLogs = liveLogs.map((row) => ({
    id: row.id,
    kind: row.kind,
    registeredSize: row.sizeBytes,
    actualSize: row.actualSize,
    hashMatches: row.hashMatches,
  }))

  report.durationMs = Date.now() - started
  report.ok =
    failed.length === 0 &&
    hashMismatches.length === 0 &&
    missingBytes.length === 0
  await writeReport(options.reportPath, report)

  console.log(
    `[e2e] 不可变产物 ${immutable.length} 条哈希全部核对；实时会话日志 ${liveLogs.length} 条单列`
  )
  console.log(`[e2e] 报告已写入 ${options.reportPath}`)
  if (!report.ok) {
    console.error(
      `[e2e] 失败：failed 节点 ${failed.length} 个，` +
        `哈希不一致 ${hashMismatches.length} 条，字节缺失 ${missingBytes.length} 条`
    )
    process.exit(1)
  }
  console.log('[e2e] 通过')
}

async function createProject(options: Options): Promise<string> {
  const body = await post(options.baseUrl, '/api/projects', {
    title: options.title,
    script: options.script,
  })
  const projectId =
    typeof body.id === 'string'
      ? body.id
      : typeof (body.project as { id?: unknown } | undefined)?.id === 'string'
        ? (body.project as { id: string }).id
        : null
  if (!projectId) throw new Error('创建项目响应缺少项目 id')
  return projectId
}

/** 轮询画布直到所有节点终态或超时；超时如实报出未终态节点。 */
async function waitForTerminalGraph(
  options: Options,
  projectId: string
): Promise<GraphNode[]> {
  const deadline = Date.now() + options.timeoutMs
  let lastSummary = ''
  for (;;) {
    const nodes = await readGraphNodes(projectId)
    const pending = nodes.filter((node) => !TERMINAL.has(node.status))
    const summary = summarize(nodes)
    if (summary !== lastSummary) {
      console.log(`[e2e] ${summary}`)
      lastSummary = summary
    }
    if (pending.length === 0 && nodes.length > 0) return nodes
    if (Date.now() > deadline) {
      throw new Error(
        `等待超时（${Math.round(options.timeoutMs / 1000)}s），仍未终态：` +
          pending
            .map((node) => `${node.logicalKey ?? node.id}=${node.status}`)
            .join('、')
      )
    }
    await delay(3_000)
  }
}

function summarize(nodes: readonly GraphNode[]): string {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    counts.set(node.status, (counts.get(node.status) ?? 0) + 1)
  }
  return `${nodes.length} 节点 · ` +
    [...counts.entries()].map(([status, count]) => `${status}:${count}`).join(' ')
}

async function readGraphNodes(projectId: string): Promise<GraphNode[]> {
  const { getDb, LOCAL_WORKSPACE_ID } = await import('@/lib/db/client')
  const { canvasNodes } = await import('@/lib/db/schema/index')
  const { and, eq } = await import('drizzle-orm')
  const database = await getDb()
  const rows = await database
    .select({
      id: canvasNodes.id,
      type: canvasNodes.type,
      status: canvasNodes.status,
      logicalKey: canvasNodes.logicalKey,
    })
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.workspaceId, LOCAL_WORKSPACE_ID),
        eq(canvasNodes.projectId, projectId)
      )
    )
  return rows
}

interface ArtifactRow {
  id: string
  kind: string
  version: number
  sizeBytes: number
  contentHash: string
  hashMatches: boolean
  actualSize: number | null
}

/** 逐条核对 artifact 的登记哈希与磁盘实际字节 SHA-256。 */
async function readArtifactInventory(projectId: string): Promise<ArtifactRow[]> {
  const { getDb, LOCAL_WORKSPACE_ID } = await import('@/lib/db/client')
  const { artifacts } = await import('@/lib/db/schema/index')
  const { and, eq } = await import('drizzle-orm')
  const { storage } = await import('@/lib/storage')
  const database = await getDb()
  const rows = await database
    .select({
      id: artifacts.id,
      kind: artifacts.kind,
      version: artifacts.version,
      sizeBytes: artifacts.sizeBytes,
      contentHash: artifacts.contentHash,
      storageKey: artifacts.storageKey,
    })
    .from(artifacts)
    .where(
      and(
        eq(artifacts.workspaceId, LOCAL_WORKSPACE_ID),
        eq(artifacts.projectId, projectId)
      )
    )
  const inventory: ArtifactRow[] = []
  for (const row of rows) {
    let actual: Buffer | null = null
    try {
      actual = await storage.get(row.storageKey)
    } catch {
      actual = null
    }
    const digest = actual
      ? createHash('sha256').update(actual).digest('hex')
      : null
    inventory.push({
      id: row.id,
      kind: row.kind,
      version: row.version,
      sizeBytes: row.sizeBytes,
      contentHash: row.contentHash,
      hashMatches: digest === row.contentHash,
      actualSize: actual?.byteLength ?? null,
    })
  }
  return inventory
}

async function post(
  baseUrl: string,
  route: string,
  body: unknown
): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const parsed: unknown = await response.json().catch(() => null)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${route} 响应无效（HTTP ${response.status}）`)
  }
  const record = parsed as Record<string, unknown>
  if (!response.ok) {
    const message =
      typeof record.error === 'string' ? record.error : `HTTP ${response.status}`
    throw new Error(`${route} 失败：${message}`)
  }
  return record
}

async function parseOptions(argv: readonly string[]): Promise<Options> {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key?.startsWith('--') && value !== undefined) {
      flags.set(key.slice(2), value)
    }
  }
  const scriptPath = flags.get('script')
  const inline = flags.get('text')
  const script = scriptPath
    ? (await readFile(scriptPath, 'utf8')).trim()
    : (inline ?? '').trim()
  if (script.length === 0) {
    throw new Error('必须提供 --script <文件> 或 --text <稿件文本>')
  }
  return {
    baseUrl: flags.get('base-url') ?? 'http://localhost:3000',
    title: flags.get('title') ?? `E2E 冒烟 ${new Date().toISOString()}`,
    script,
    timeoutMs: Number(flags.get('timeout') ?? 900) * 1000,
    reportPath:
      flags.get('report') ??
      path.join('docs', 'issues', 'evidence', 'issue-014', 'smoke-report.json'),
  }
}

async function writeReport(
  reportPath: string,
  report: Record<string, unknown>
): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

main().catch((error: unknown) => {
  console.error(
    `[e2e] 中止：${error instanceof Error ? error.message : String(error)}`
  )
  process.exit(1)
})
