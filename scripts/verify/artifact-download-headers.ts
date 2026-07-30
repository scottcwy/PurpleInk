/**
 * 取证：`/api/artifacts/[id]` 的下载合同真实 HTTP 证据。
 *
 * 单测锁的是 header 字符串，这里锁的是「Next 真的把它发出来了」。对同一个真实
 * 产物发两次请求：不带 `download` 必须内联（无 Content-Disposition，画布检查器
 * 与成片预览依赖它），带 `download=1` 必须是 attachment 且文件名可追溯到
 * content hash 前缀。
 *
 * 用法（需要 pnpm dev 与 CVC_VERIFY_ACCOUNT）：
 *   npx tsx scripts/verify/artifact-download-headers.ts
 *
 * 只打印 header 与状态码，不回显凭据、不落盘字节。
 */
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

const BASE_URL = process.env.CVC_VERIFY_BASE_URL ?? 'http://localhost:3000'

interface Probe {
  label: string
  status: number
  contentType: string | null
  contentLength: string | null
  contentDisposition: string | null
}

async function main(): Promise<void> {
  const cookie = await login()
  const target = await findReadable(cookie, readCandidates())
  console.log(
    `[download] 目标产物 kind=${target.kind} hash12=${target.contentHash.slice(0, 12)}`
  )

  const inline = await probe(cookie, target, false, '默认（无 download）')
  const attachment = await probe(cookie, target, true, 'download=1')
  console.table([inline, attachment])

  const failures: string[] = []
  if (inline.status !== 200) failures.push('内联请求未返回 200')
  if (inline.contentDisposition !== null) {
    failures.push('内联请求不应带 Content-Disposition')
  }
  if (attachment.status !== 200) failures.push('下载请求未返回 200')
  const expectedName = `${target.kind.replaceAll(/[^a-z0-9]+/gu, '-')}-${target.contentHash.slice(0, 12)}`
  if (
    !attachment.contentDisposition?.startsWith('attachment; filename="')
    || !attachment.contentDisposition.includes(expectedName)
  ) {
    failures.push(
      `下载请求的 Content-Disposition 不含预期文件名 ${expectedName}：`
        + String(attachment.contentDisposition)
    )
  }
  if (inline.contentType !== attachment.contentType) {
    failures.push('两次请求的 content-type 不一致')
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[download] FAIL ${failure}`)
    process.exitCode = 1
    return
  }
  console.log('[download] PASS 内联与附件两条路径的响应头均符合合同')
}

async function login(): Promise<string> {
  const account = process.env.CVC_VERIFY_ACCOUNT ?? ''
  const separator = account.indexOf(':')
  if (separator <= 0) {
    throw new Error('缺少 CVC_VERIFY_ACCOUNT（email:password）')
  }
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: account.slice(0, separator),
      password: account.slice(separator + 1),
    }),
  })
  const match = /cvc_session=([^;]+)/.exec(
    response.headers.get('set-cookie') ?? ''
  )
  if (!response.ok || !match) {
    throw new Error(`登录失败（HTTP ${String(response.status)}）`)
  }
  return `cvc_session=${match[1]}`
}

interface ArtifactTarget {
  id: string
  projectId: string
  kind: string
  contentHash: string
}

/**
 * 候选产物由调用方经 argv 传入，脚本本身不连数据库。
 *
 * `@/lib/db/client` 是 `server-only`，tsx 直跑会报 Cannot find module；而这份
 * 取证只关心 HTTP 响应头，不需要 ORM。候选用 psql 查出后按
 * `id,projectId,kind,contentHash` 逐条传入，脚本取第一条会话真能读到的：
 * 产物按 workspace 隔离，本机有 20 个工作区，盲取最新一条通常不属于验证账号。
 *
 * 刻意避开 website-video-mp4：那条 kind 另有执行快照与哈希门禁，404 会来自与
 * 下载合同无关的原因。
 */
function readCandidates(): ArtifactTarget[] {
  const candidates = process.argv.slice(2).map((raw) => {
    const [id, projectId, kind, contentHash] = raw.split(',')
    if (!id || !projectId || !kind || !contentHash) {
      throw new Error(`候选格式错误（需 id,projectId,kind,contentHash）：${raw}`)
    }
    return { id, projectId, kind, contentHash }
  })
  if (candidates.length === 0) {
    throw new Error(
      '用法：tsx scripts/verify/artifact-download-headers.ts <id,projectId,kind,hash> [...]'
    )
  }
  return candidates
}

/** 逐个候选试读，返回第一个当前会话有权读到的。 */
async function findReadable(
  cookie: string,
  candidates: ArtifactTarget[]
): Promise<ArtifactTarget> {
  for (const candidate of candidates) {
    const result = await probe(cookie, candidate, false, 'discovery')
    if (result.status === 200) return candidate
  }
  throw new Error(
    `${String(candidates.length)} 个候选产物都不属于验证账号所在工作区，无法取证`
  )
}

async function probe(
  cookie: string,
  target: ArtifactTarget,
  download: boolean,
  label: string
): Promise<Probe> {
  const url =
    `${BASE_URL}/api/artifacts/${target.id}`
    + `?projectId=${encodeURIComponent(target.projectId)}`
    + (download ? '&download=1' : '')
  const response = await fetch(url, { headers: { cookie } })
  // 读掉 body 释放连接，但不落盘也不打印内容。
  await response.arrayBuffer()
  return {
    label,
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    contentDisposition: response.headers.get('content-disposition'),
  }
}

void main().catch((error: unknown) => {
  console.error(
    `[download] 取证失败：${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
