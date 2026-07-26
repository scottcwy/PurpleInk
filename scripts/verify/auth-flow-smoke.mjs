// 认证链路真实取证：人机验证 → 签发验证码 → 注册 → 会话 → 守卫 → 登出。
// 验证码值直接从数据库反查（本地取证专用），证据里只记状态码与脱敏字段。
import postgres from 'postgres'

const BASE = process.env.CVC_SHOT_BASE_URL ?? 'http://localhost:3000'
const sql = postgres(process.env.DATABASE_URL, { max: 1 })
const stamp = Date.now()
const EMAIL = `kiro-auth-${stamp}@example.com`
const PASSWORD = 'Verify-Auth-2026'
const log = []

function record(label, response, extra = '') {
  const line = `${label}: ${response.status}${extra ? ' ' + extra : ''}`
  log.push(line)
  console.log(line)
}

async function postJson(path, body, cookie) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  })
}

function sessionCookie(response) {
  const raw = response.headers.getSetCookie?.() ?? []
  const entry = raw.find((value) => value.startsWith('cvc_session='))
  return entry ? entry.split(';')[0] : null
}

try {
  // 1. 人机验证挑战
  const challengeResponse = await fetch(`${BASE}/api/auth/human-check`)
  const challenge = await challengeResponse.json()
  const answer = String(Function(`"use strict";return (${challenge.question.replace(/×/g, '*')})`)())
  record('GET /api/auth/human-check', challengeResponse, `question=${challenge.question}`)

  // 2. 蜜罐非空必须被拒
  const honeypotResponse = await postJson('/api/auth/signup/code', {
    email: EMAIL,
    humanCheckToken: challenge.token,
    humanCheckAnswer: answer,
    contactReference: 'bot',
  })
  record('POST signup/code 蜜罐非空', honeypotResponse, '(期望 422)')

  // 3. 最短填写时长：立即提交必须被拒
  const fastResponse = await postJson('/api/auth/signup/code', {
    email: EMAIL,
    humanCheckToken: challenge.token,
    humanCheckAnswer: answer,
  })
  record('POST signup/code 提交过快', fastResponse, '(期望 422)')

  // 4. 等过最短停留时长后正常签发
  await new Promise((resolve) => setTimeout(resolve, 1_800))
  const codeResponse = await postJson('/api/auth/signup/code', {
    email: EMAIL,
    humanCheckToken: challenge.token,
    humanCheckAnswer: answer,
  })
  record('POST signup/code 正常签发', codeResponse, JSON.stringify(await codeResponse.json()))

  const [row] = await sql`
    select id, code_hash, expires_at, created_at, attempt_count
    from email_verification_codes
    where email = ${EMAIL} and purpose = 'signup'
    order by created_at desc limit 1
  `
  if (!row) throw new Error('验证码未落库')
  // TTL 必须在**同一个时钟**里比较：`created_at` 是 DB 的 now()，`expires_at` 是
  // 应用侧 new Date() + 600000。本机 docker 容器与主机存在秒级时钟漂移，
  // 跨时钟相减会得到 9.3 分钟这类假结果，不是代码问题。
  const [{ app_ttl_ms: appTtlMs }] = await sql`
    select extract(epoch from (${row.expires_at}::timestamptz - ${row.created_at}::timestamptz)) * 1000 as app_ttl_ms
  `
  const [{ drift_ms: driftMs }] = await sql`
    select extract(epoch from (now() - ${new Date()}::timestamptz)) * 1000 as drift_ms
  `
  log.push(
    `验证码落库：codeHash 长度=${row.code_hash.length}（只存摘要）`
    + ` 跨时钟 TTL=${Math.round(Number(appTtlMs))}ms`
    + ` 容器时钟漂移=${Math.round(Number(driftMs))}ms`
    + ` 校正后 TTL=${Math.round(Number(appTtlMs) + Number(driftMs))}ms（期望 600000）`,
  )
  console.log(log.at(-1))

  // 过期路径的真实校验：把 expires_at 人为前移到过去（这是**取证手段**，
  // 不是 fixture 数据），确认 API 如实回 422 而不是放行。
  await sql`
    update email_verification_codes set expires_at = now() - interval '1 second'
    where id = ${row.id}
  `
  const expiredResponse = await postJson('/api/auth/signup', {
    email: EMAIL,
    name: 'Kiro 取证',
    workspaceName: 'x',
    password: PASSWORD,
    code: await findCode(row.code_hash, EMAIL),
  })
  record('POST signup 已过期验证码（人为前移 expires_at）', expiredResponse, '(期望 422)')
  await sql`
    update email_verification_codes set expires_at = ${row.expires_at} where id = ${row.id}
  `

  // 5. 错误验证码必须 422 且计入尝试次数
  const wrongResponse = await postJson('/api/auth/signup', {
    email: EMAIL,
    name: 'Kiro 取证',
    workspaceName: 'Kiro 取证 Workspace',
    password: PASSWORD,
    code: '000000',
  })
  record('POST signup 错误验证码', wrongResponse, '(期望 422)')
  const [afterWrong] = await sql`
    select attempt_count from email_verification_codes where id = ${row.id}
  `
  log.push(`错误尝试已计数：attempt_count=${afterWrong.attempt_count}`)
  console.log(log.at(-1))

  // 6. 用真实验证码注册（本地取证：从 DB 摘要反查明文码）
  const code = await findCode(row.code_hash, EMAIL)
  const signupResponse = await postJson('/api/auth/signup', {
    email: EMAIL,
    name: 'Kiro 取证',
    workspaceName: 'Kiro 取证 Workspace',
    password: PASSWORD,
    code,
  })
  const signupBody = await signupResponse.json()
  record('POST signup 正确验证码', signupResponse, JSON.stringify(signupBody))
  const cookie = sessionCookie(signupResponse)
  log.push(`会话 cookie 已下发：${cookie ? cookie.split('=')[0] + '=<43 字符随机>' : '缺失'}`)
  console.log(log.at(-1))

  // 7. 归属：单事务建了 user + workspace + owner 成员关系
  const [ownership] = await sql`
    select u.id as user_id, w.id as workspace_id, w.name as workspace_name, m.role
    from users u
    join workspace_members m on m.user_id = u.id
    join workspaces w on w.id = m.workspace_id
    where lower(u.email) = ${EMAIL}
  `
  log.push(`归属：role=${ownership.role} workspace=${ownership.workspace_name}`)
  console.log(log.at(-1))

  // 8. 大小写重复注册必须被唯一索引挡住
  const dupeResponse = await postJson('/api/auth/signup', {
    email: EMAIL.toUpperCase(),
    name: 'Kiro 取证',
    workspaceName: 'x',
    password: PASSWORD,
    code,
  })
  record('POST signup 同邮箱大写重注册', dupeResponse, '(期望非 201)')

  // 9. 守卫：未登录 /products/dashboard → 302 带 next
  const guardResponse = await fetch(`${BASE}/products/dashboard`, { redirect: 'manual' })
  record(
    'GET /products/dashboard 未登录',
    guardResponse,
    `location=${guardResponse.headers.get('location')}`,
  )

  // 10. 守卫：未登录调 AI 管线 → 401
  const apiResponse = await postJson('/api/director/pipeline', { projectId: ownership.workspace_id })
  record('POST /api/director/pipeline 未登录', apiResponse, JSON.stringify(await apiResponse.json()))

  // 11. 已登录访问 /login → 302 到 dashboard
  const loggedInLogin = await fetch(`${BASE}/login`, {
    headers: { cookie },
    redirect: 'manual',
  })
  record('GET /login 已登录', loggedInLogin, `location=${loggedInLogin.headers.get('location')}`)

  // 12. 登录失败：账号不存在与口令错必须同状态同文案
  const noSuchUser = await postJson('/api/auth/login', {
    email: `absent-${stamp}@example.com`,
    password: PASSWORD,
  })
  const wrongPassword = await postJson('/api/auth/login', { email: EMAIL, password: 'Wrong-Pass-9999' })
  const bodyA = await noSuchUser.json()
  const bodyB = await wrongPassword.json()
  record('POST login 账号不存在', noSuchUser, JSON.stringify(bodyA))
  record('POST login 口令错误', wrongPassword, JSON.stringify(bodyB))
  log.push(
    `不可枚举：状态相同=${noSuchUser.status === wrongPassword.status} 文案相同=${bodyA.error === bodyB.error}`,
  )
  console.log(log.at(-1))

  // 13. 正常登录
  const loginResponse = await postJson('/api/auth/login', { email: EMAIL, password: PASSWORD })
  record('POST login 正确凭据', loginResponse, JSON.stringify(await loginResponse.json()))
  const loginCookie = sessionCookie(loginResponse)

  // 14. 会话最小视图不泄露内部标识
  const sessionResponse = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: loginCookie } })
  const sessionBody = await sessionResponse.json()
  record('GET /api/auth/session', sessionResponse, JSON.stringify(sessionBody))
  log.push(
    `最小视图无内部标识：${!('userId' in sessionBody) && !('workspaceId' in sessionBody)}`,
  )
  console.log(log.at(-1))

  // 15. 登出后会话行必须消失
  const logoutResponse = await postJson('/api/auth/logout', {}, loginCookie)
  record('POST logout', logoutResponse)
  const afterLogout = await fetch(`${BASE}/api/auth/session`, { headers: { cookie: loginCookie } })
  record('GET /api/auth/session 登出后', afterLogout, JSON.stringify(await afterLogout.json()))

  console.log('\n--- 汇总 ---\n' + log.join('\n'))
} finally {
  await sql.end()
}

/** 本地取证专用：6 位码空间只有 10^6，逐个比对摘要即可还原，无需读明文邮件。 */
async function findCode(codeHash, email) {
  const { createHmac, hkdfSync } = await import('node:crypto')
  const master = Buffer.from(process.env.CVC_CREDENTIAL_MASTER_KEY, 'base64')
  const key = Buffer.from(
    hkdfSync('sha256', master, 'cvc.auth.hkdf/v1', 'cvc.auth.verification-code/v1', 32),
  )
  for (let value = 0; value < 1_000_000; value += 1) {
    const candidate = String(value).padStart(6, '0')
    const digest = createHmac('sha256', key)
      .update(
        ['cvc.auth.verification-code/v1', 'signup', email, candidate].join('\u0000'),
        'utf8',
      )
      .digest('hex')
    if (digest === codeHash) return candidate
  }
  throw new Error('无法还原验证码')
}
