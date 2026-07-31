// 路演前的功能连通性检查：确认登录体系接入后，既有制作链路一行未断。
// 只读为主；建项目那步会真的写库，跑完自行删除。
import postgres from 'postgres'

const BASE = process.env.CVC_SHOT_BASE_URL ?? 'http://localhost:3000'
const EMAIL = 'dev@purpleink.local'
const PASSWORD = 'PurpleInk-2026'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const problems = []
let createdProjectId = null

function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: ${actual}${ok ? '' : ` (期望 ${expected})`}`)
  if (!ok) problems.push(`${label}=${actual} 期望 ${expected}`)
}

try {
  // 1. 登录拿会话
  const loginResponse = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  check('POST /api/auth/login', loginResponse.status, 200)
  const cookie = (loginResponse.headers.getSetCookie() ?? [])
    .find((value) => value.startsWith('cvc_session='))
    ?.split(';')[0]
  if (!cookie) throw new Error('未拿到会话 cookie')
  const auth = { cookie }

  // 2. 未登录访问应用页 → 302 到 /login；登录后 → 200
  const guard = await fetch(`${BASE}/products/dashboard`, { redirect: 'manual' })
  check('GET /products/dashboard 未登录', guard.status, 307)
  for (const path of [
    '/products/dashboard',
    '/products/projects',
    '/products/settings',
    '/login',
    '/signup',
    '/password/reset',
    '/',
  ]) {
    const response = await fetch(`${BASE}${path}`, {
      headers: path.startsWith('/products') ? auth : {},
      redirect: 'manual',
    })
    check(`GET ${path}${path.startsWith('/products') ? ' 已登录' : ''}`, response.status, 200)
  }

  // 3. 既有 API 仍按原样工作（尚未接会话，路演后再收口）
  const projectsResponse = await fetch(`${BASE}/api/projects`, { headers: auth })
  const { projects } = await projectsResponse.json()
  check('GET /api/projects', projectsResponse.status, 200)
  console.log(`     现有项目 ${projects.length} 个`)
  if (projects.length === 0) problems.push('项目列表为空，路演无内容可演示')

  const sample = projects[0]
  for (const [label, path] of [
    ['画布页', `/products/canvas/${sample.id}`],
    ['导出页', `/products/export/${sample.id}`],
  ]) {
    const response = await fetch(`${BASE}${path}`, { headers: auth, redirect: 'manual' })
    check(`GET ${label}`, response.status, 200)
  }

  const exportResponse = await fetch(
    `${BASE}/api/render/export?projectId=${sample.id}`,
    { headers: auth },
  )
  check('GET /api/render/export', exportResponse.status, 200)

  const settingsResponse = await fetch(`${BASE}/api/settings`, { headers: auth })
  const settings = await settingsResponse.json()
  check('GET /api/settings', settingsResponse.status, 200)
  console.log(
    `     凭据 stepfun=${settings.configured} gemini=${settings.geminiConfigured}`
    + ` 并发 director=${settings.laneQuotas?.directorStage?.value}`
    + ` render=${settings.laneQuotas?.renderShot?.value}`,
  )
  if (!settings.configured && !settings.geminiConfigured) {
    problems.push('两个 AI 提供商凭据都未配置，AI 生成链路无法演示')
  }

  // 4. 建项目 + INGEST 入队：这是路演的第一个动作，必须真的能跑
  const createResponse = await fetch(`${BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      title: `路演连通性检查 ${new Date().toISOString().slice(11, 19)}`,
      script: '这是一段用于连通性检查的文字稿，跑完即删。',
      visualTheme: 'dark',
    }),
  })
  const created = await createResponse.json()
  check('POST /api/projects', createResponse.status, 201)
  createdProjectId = created.project?.id ?? null
  console.log(`     ingestNodeId=${created.ingestNodeId ?? '缺失'}`)
  if (!created.ingestNodeId) problems.push('新建项目没有 INGEST 节点')

  // 5. SSE：登录后画布状态流仍能建立（cookie 会话没有破坏 EventSource 路径）
  const sseResponse = await fetch(
    `${BASE}/api/director/stream/project/${createdProjectId}`,
    { headers: auth },
  )
  check('GET 画布状态流 SSE', sseResponse.status, 200)
  check(
    '     SSE content-type',
    sseResponse.headers.get('content-type')?.split(';')[0],
    'text/event-stream',
  )
  const reader = sseResponse.body.getReader()
  const first = await Promise.race([
    reader.read().then(({ value }) => new TextDecoder().decode(value)),
    new Promise((resolve) => setTimeout(() => resolve('<超时未收到帧>'), 5000)),
  ])
  console.log(`     首帧 ${JSON.stringify(first.slice(0, 90))}`)
  if (!first.startsWith('event:')) problems.push('SSE 未收到 snapshot 帧')
  await reader.cancel()

  console.log(
    problems.length === 0
      ? '\n结论：登录体系接入后既有链路连通，路演可用。'
      : `\n结论：${problems.length} 项需要处理：\n- ${problems.join('\n- ')}`,
  )
} finally {
  if (createdProjectId) {
    await sql`delete from projects where id = ${createdProjectId}`
    console.log(`[cleanup] 已删除连通性检查项目 ${createdProjectId}`)
  }
  await sql.end()
}
if (problems.length > 0) process.exitCode = 1
