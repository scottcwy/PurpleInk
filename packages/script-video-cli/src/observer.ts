import { createReadStream } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import type { CliArgs } from './args'
import type { CliConfig } from './config'
import { listRuns, resolveRunDir } from './run-management'
import { SafeCliError } from './safe-error'
import { artifactIndexSchema, type ArtifactRecord, type RunRecord } from './state/store'

export interface ObserverHandle {
  url: string
  port: number
  close(): Promise<void>
  server: Server
}

export async function serveCommand(args: CliArgs, config: CliConfig): Promise<Record<string, unknown>> {
  const runDir = args.resumeDir ? await resolveRunDir(args.resumeDir, config.stateDir) : undefined
  const observer = await startObserver({ stateDir: config.stateDir, runDir, port: args.port ?? 0 })
  return { command: 'serve', url: observer.url, port: observer.port, runDir: runDir ?? null }
}

export async function startObserver(options: {
  stateDir: string
  runDir?: string
  port?: number
}): Promise<ObserverHandle> {
  const server = createServer((request, response) => {
    void handleRequest(request.url ?? '/', response, options).catch(() =>
      sendText(response, 500, 'Observer request failed'),
    )
  })
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => resolveReady())
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new SafeCliError('OBSERVER_START_FAILED', '无法启动本地观察页。', false, 500)
  return {
    url: `http://127.0.0.1:${address.port}/`,
    port: address.port,
    server,
    close: () =>
      new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose()))),
  }
}

async function handleRequest(
  rawUrl: string,
  response: ServerResponse,
  options: { stateDir: string; runDir?: string },
): Promise<void> {
  const url = new URL(rawUrl, 'http://127.0.0.1')
  if (url.pathname === '/favicon.ico') {
    response.writeHead(204, { 'Cache-Control': 'public, max-age=86400' })
    response.end()
    return
  }
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length === 0) return renderHome(response, options)
  if (parts[0] === 'run' && parts[1]) {
    const runDir = await resolveRunDir(parts[1], options.stateDir)
    if (parts[2] === 'shot' && parts[3]) return renderShot(response, runDir, parts[3])
    return renderRun(response, runDir)
  }
  if (parts[0] === 'artifact' && parts[1] && parts[2]) {
    return streamArtifact(
      response,
      await resolveRunDir(parts[1], options.stateDir),
      parts[2],
      url.searchParams.get('preview') === 'midpoint',
    )
  }
  sendText(response, 404, 'Not found')
}

async function renderHome(response: ServerResponse, options: { stateDir: string; runDir?: string }): Promise<void> {
  const runs = options.runDir
    ? [JSON.parse(await readFile(resolve(options.runDir, 'state', 'run.json'), 'utf8')) as RunRecord]
    : await listRuns(options.stateDir)
  const cards = runs
    .map(
      (run) => `<a class="card" href="/run/${encodeURIComponent(run.runId)}">
        <strong>${escapeHtml(run.title)}</strong>${renderRunStatus(run.status)}
        <small>${escapeHtml(run.updatedAt)}</small>
      </a>`,
    )
    .join('')
  sendHtml(
    response,
    page(
      'PurpleInk Runs',
      `<header><h1>本地文稿视频</h1><p>运行、分镜与最终产物</p></header><main class="grid">${cards || '<p>暂无 run</p>'}</main>`,
    ),
  )
}

async function renderRun(response: ServerResponse, runDir: string): Promise<void> {
  const run = JSON.parse(await readFile(resolve(runDir, 'state', 'run.json'), 'utf8')) as RunRecord
  const artifacts = await readArtifacts(runDir)
  const stages = await readStageFiles(runDir)
  const shots = unique(
    artifacts
      .map((artifact) => artifact.id.match(/^shot-(S\d{3})-/u)?.[1])
      .filter((value): value is string => Boolean(value)),
  )
  const video = artifacts.find((artifact) => artifact.id === 'video')
  const shotLinks = shots
    .map((shot) => `<a class="pill" href="/run/${encodeURIComponent(run.runId)}/shot/${shot}">${shot}</a>`)
    .join('')
  const timeline = stages
    .map(
      (stage) =>
        `<li><span>${escapeHtml(stage.key)}</span><b>${escapeHtml(stage.status)}</b><small>#${stage.attempt}</small></li>`,
    )
    .join('')
  const player = video
    ? `<section><h2>最终视频</h2><video controls src="${artifactUrl(run.runId, video.id)}"></video><p class="path">${escapeHtml(video.absolutePath)}</p></section>`
    : '<section><h2>最终视频</h2><p>尚未生成</p></section>'
  const reviewNotice =
    video && awaitsAgentReview(run.status)
      ? '<aside class="review-notice"><span class="review-icon" aria-hidden="true">◷</span><div><strong>MP4 已生成，等待 Agent 最终验收</strong><p>可以立即预览；最终交付仍需完成媒体检查、全片抽帧和分镜复核。</p></div></aside>'
      : ''
  sendHtml(
    response,
    page(
      run.title,
      `<nav><a href="/">← 所有运行</a></nav><header><h1>${escapeHtml(run.title)}</h1><div class="run-meta">${renderRunStatus(run.status, Boolean(video))}<code>${escapeHtml(run.runId)}</code></div></header>
      <main>${reviewNotice}${player}<section><h2>分镜</h2><div class="pills">${shotLinks || '暂无'}</div></section><section><h2>阶段时间线</h2><ol class="timeline">${timeline}</ol></section></main>`,
    ),
  )
}

async function renderShot(response: ServerResponse, runDir: string, shotId: string): Promise<void> {
  if (!/^S\d{3}$/u.test(shotId)) return sendText(response, 404, 'Shot not found')
  const run = JSON.parse(await readFile(resolve(runDir, 'state', 'run.json'), 'utf8')) as RunRecord
  const artifacts = (await readArtifacts(runDir)).filter((artifact) => artifact.id.includes(`-${shotId}-`))
  const html = artifacts.find((artifact) => artifact.kind === 'text/html')
  const audio = artifacts.find((artifact) => artifact.kind === 'audio/wav')
  const images = artifacts.filter((artifact) => artifact.kind === 'image/png')
  const gallery = images
    .map((artifact) => `<img src="${artifactUrl(run.runId, artifact.id)}" alt="${escapeHtml(artifact.id)}">`)
    .join('')
  const snapshots = gallery ? `<section><h2>镜头快照</h2><div class="gallery">${gallery}</div></section>` : ''
  sendHtml(
    response,
    page(
      shotId,
      `<nav><a href="/run/${encodeURIComponent(run.runId)}">← 返回 run</a></nav><header><h1>${shotId}</h1><p>${escapeHtml(run.title)}</p></header><main>
      ${snapshots}
      ${html ? `<section><h2>HTML 中点预览</h2><p>仅用于镜头诊断；最终验收以 MP4 抽帧为准。</p><iframe sandbox="allow-scripts" src="${artifactUrl(run.runId, html.id)}?preview=midpoint"></iframe><p class="path">${escapeHtml(html.absolutePath)}</p></section>` : ''}
      ${audio ? `<section><h2>旁白</h2><audio controls src="${artifactUrl(run.runId, audio.id)}"></audio><p class="path">${escapeHtml(audio.absolutePath)}</p></section>` : ''}
      </main>`,
    ),
  )
}

async function streamArtifact(
  response: ServerResponse,
  runDir: string,
  artifactId: string,
  midpointPreview = false,
): Promise<void> {
  const artifact = (await readArtifacts(runDir)).find((candidate) => candidate.id === artifactId)
  if (!artifact || !safeArtifactPath(runDir, artifact.absolutePath))
    return sendText(response, 404, 'Artifact not found')
  try {
    await access(artifact.absolutePath)
  } catch {
    return sendText(response, 404, 'Artifact missing')
  }
  response.writeHead(200, {
    'Content-Type': artifact.kind,
    'Content-Disposition': `inline; filename="${basename(artifact.absolutePath).replace(/"/gu, '')}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(artifact.kind === 'text/html'
      ? {
          'Content-Security-Policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'none'; media-src 'none'",
        }
      : {}),
  })
  if (artifact.kind === 'text/html' && midpointPreview) {
    const source = await readFile(artifact.absolutePath, 'utf8')
    response.end(injectMidpointPreview(source))
    return
  }
  createReadStream(artifact.absolutePath).pipe(response)
}

function injectMidpointPreview(source: string): string {
  const previewScript = `<script>(()=>{const render=window.__PURPLEINK_RENDER__;if(!render)return;if(typeof render.seek==='function')render.seek(0.5);else if(render.timeline&&typeof render.timeline.progress==='function')render.timeline.progress(0.5).pause();const root=document.querySelector('[data-pi-seed]');if(!root)return;const fit=()=>{const scale=Math.min(innerWidth/1920,innerHeight/1080);document.documentElement.style.cssText+=';width:100%;height:100%;overflow:hidden';document.body.style.cssText+=';width:100%;height:100%;overflow:hidden';root.style.transformOrigin='top left';root.style.transform='scale('+scale+')'};fit();addEventListener('resize',fit)})()</script>`
  return source.includes('</body>') ? source.replace('</body>', `${previewScript}</body>`) : `${source}${previewScript}`
}

async function readArtifacts(runDir: string): Promise<ArtifactRecord[]> {
  const value = JSON.parse(await readFile(resolve(runDir, 'artifacts', 'index.json'), 'utf8')) as unknown
  return artifactIndexSchema.parse(value).artifacts
}

async function readStageFiles(runDir: string): Promise<Array<{ key: string; status: string; attempt: number }>> {
  const directory = resolve(runDir, 'state', 'stages')
  const names = await import('node:fs/promises').then((fs) => fs.readdir(directory)).catch(() => [])
  const values = await Promise.all(
    names.map(async (name) => {
      try {
        const value = JSON.parse(await readFile(resolve(directory, name), 'utf8')) as unknown
        if (
          isRecord(value) &&
          typeof value.key === 'string' &&
          typeof value.status === 'string' &&
          typeof value.attempt === 'number'
        )
          return { key: value.key, status: value.status, attempt: value.attempt }
      } catch {
        return null
      }
      return null
    }),
  )
  return values
    .filter((value): value is { key: string; status: string; attempt: number } => value !== null)
    .sort((a, b) => a.key.localeCompare(b.key))
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${body}</body></html>`
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; frame-src 'self'",
  })
  response.end(html)
}

function sendText(response: ServerResponse, status: number, value: string): void {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(value)
}

function safeArtifactPath(runDir: string, path: string): boolean {
  if (!isAbsolute(path)) return false
  const root = resolve(runDir)
  const target = resolve(path)
  const child = relative(root, target)
  return (
    child !== '' &&
    !child.startsWith('..') &&
    !isAbsolute(child) &&
    target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  )
}

function artifactUrl(runId: string, artifactId: string): string {
  return `/artifact/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function renderRunStatus(status: RunRecord['status'], hasFinalVideo = false): string {
  if (status === 'awaiting_agent_review')
    return '<span class="status status-review" data-status="awaiting_agent_review"><span aria-hidden="true">◷</span>等待 Agent 验收</span>'
  if (status === 'succeeded' && hasFinalVideo)
    return '<span class="status status-review" data-status="succeeded"><span aria-hidden="true">◷</span>执行完成（旧状态，待 Agent 验收）</span>'
  if (status === 'succeeded') return '<span class="status" data-status="succeeded">执行完成</span>'
  return `<span class="status" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`
}

function awaitsAgentReview(status: RunRecord['status']): boolean {
  return status === 'awaiting_agent_review' || status === 'succeeded'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const styles = `:root{font-family:Inter,"Segoe UI",sans-serif;color:#17181a;background:#f4f5f7}*{box-sizing:border-box}body{margin:0;padding:32px;max-width:1400px;margin:auto}a{color:#5f5ce6;text-decoration:none}header,section,.card{background:rgba(255,255,255,.86);border:1px solid rgba(0,0,0,.08);border-radius:20px;box-shadow:0 18px 50px rgba(22,24,29,.08)}header,section{padding:24px;margin:18px 0}h1,h2,p{margin-top:0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{padding:20px;display:grid;gap:10px}.status,.pill{display:inline-flex;align-items:center;gap:6px;width:max-content;padding:6px 10px;border-radius:999px;background:#ebeaff}.status-review{color:#805600;background:#fff0bf;border:1px solid #f0d274}.run-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.run-meta code{color:#666}.review-notice{display:flex;gap:14px;align-items:flex-start;padding:18px 20px;margin:18px 0;border:1px solid #efd06c;border-radius:18px;background:#fff8dc;color:#5d4600}.review-notice p{margin:4px 0 0}.review-icon{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border-radius:50%;background:#f5c84c;font-size:22px}.pills{display:flex;gap:8px;flex-wrap:wrap}.timeline{list-style:none;padding:0}.timeline li{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:12px 0;border-bottom:1px solid #e8e8eb}video,iframe{width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:#0d0e12}audio{width:100%}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.gallery img{width:100%;border-radius:12px;background:#111}.path{font-family:Consolas,monospace;overflow-wrap:anywhere;color:#666;font-size:12px}@media(max-width:760px){body{padding:14px}.gallery{grid-template-columns:1fr}}`
