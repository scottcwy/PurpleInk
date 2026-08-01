/*
 * Disposable production-shaped acceptance. It never uses the developer Compose
 * project or its volumes; artifacts stay beneath the ignored .data directory.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { createServer } from 'node:net'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium, request as playwrightRequest, type APIRequestContext } from 'playwright'
import { communityFilms } from '@/features/community/catalog'
import { createEvidenceManifest, requireIsolatedProjectName, selectVerifiedImages, verifyAdminGuardMatrix, verifyComposeIsolation, verifyMediaRange } from './contracts'

const root = process.cwd()
const compose = ['compose', '-f', 'deploy/compose.yaml', '-f', 'scripts/verify/predev-browser/compose.override.yaml']
const secret = () => randomBytes(32).toString('base64url')

async function main(): Promise<void> {
  const commit = (await run('git', ['rev-parse', 'HEAD'])).trim()
  const suffix = randomBytes(6).toString('hex')
  const project = requireIsolatedProjectName(`purpleink_predev_${suffix}`)
  const evidence = path.join(root, '.data', 'integration-evidence', commit)
  const envPath = path.join(root, '.data', `predev-browser-${suffix}.env`)
  const ports = { http: await freePort(), postgres: await freePort() }
  const values = { password: secret(), master: randomBytes(32).toString('base64'), pepper: secret(), engine: secret() }
  const env: Record<string, string> = {
    PREDEV_HTTP_PORT: String(ports.http), PREDEV_POSTGRES_PORT: String(ports.postgres),
    POSTGRES_PASSWORD: secret(), CVC_CREDENTIAL_MASTER_KEY: values.master,
    CVC_REDEMPTION_CODE_PEPPER: values.pepper, PURPLEINK_ENGINE_INTERNAL_KEY: values.engine,
    CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '1', CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '1',
    PURPLEINK_IMAGE_TAG: `sha-${'0'.repeat(40)}`, PURPLEINK_DOMAIN: 'localhost', CVC_ALLOWED_CIDRS: '0.0.0.0/0',
  }
  const secrets = [values.password, values.master, values.pepper, values.engine, env.POSTGRES_PASSWORD]
  const images = await verifiedImages(commit)
  env.PREDEV_SOURCE_COMMIT = commit
  env.PREDEV_WEB_IMAGE = images.images?.web ?? `purpleink-web:predev-${commit.slice(0, 12)}`
  env.PREDEV_WORKER_IMAGE = images.images?.worker ?? `purpleink-worker:predev-${commit.slice(0, 12)}`
  env.PREDEV_MIGRATE_IMAGE = images.images?.migrate ?? `purpleink-migrate:predev-${commit.slice(0, 12)}`
  await mkdir(evidence, { recursive: true })
  await writeFile(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'), 'utf8')
  const baseUrl = `https://127.0.0.1:${ports.http}`
  const facts: Record<string, unknown> = { phases: [] as string[], baseUrl, imageMode: images.mode }
  const checkpoint = async (phase: string, result: 'started' | 'passed' | 'blocked') => {
    ;(facts.phases as string[]).push(`${phase}:${result}`)
    await writeEvidence(evidence, commit, baseUrl, project, secrets, facts)
  }
  try {
    await checkpoint('compose', 'started')
    await docker(project, envPath, ['up', ...(images.mode === 'no-build' ? ['--no-build'] : ['--build']), '--wait'])
    await checkpoint('compose', 'passed')
    await checkpoint('migrations', 'started')
    await docker(project, envPath, ['run', '--rm', 'migrate'])
    await docker(project, envPath, ['run', '--rm', 'migrate'])
    facts.migrations = 'twice after Compose migration'
    await checkpoint('migrations', 'passed')
    await waitFor(() => httpsStatus(`${baseUrl}/api/ping`), 200)
    await checkpoint('marketing', 'started'); await acceptMarketing(baseUrl, evidence, facts); await checkpoint('marketing', 'passed')
    await checkpoint('media', 'started'); await acceptMedia(baseUrl, facts); await checkpoint('media', 'passed')
    await checkpoint('runtime', 'started'); await acceptRuntime(project, envPath, facts); await checkpoint('runtime', 'passed')
    await checkpoint('admin', 'started'); await acceptAdmin(baseUrl, values.password, env, facts, secrets); await checkpoint('admin', 'passed')
    await docker(project, envPath, ['restart', 'postgres', 'web', 'worker', 'caddy'])
    await waitFor(() => httpsStatus(`${baseUrl}/api/ping`), 200)
    facts.restartPersistence = 'services restarted and ping recovered'
    await checkpoint('restart', 'passed')
  } catch (error) {
    facts.failure = error instanceof Error ? redactMessage(error.message, secrets) : 'unknown acceptance failure'
    await checkpoint('failure', 'blocked')
    throw error
  } finally {
    await docker(project, envPath, ['down', '--volumes', '--remove-orphans']).catch(() => undefined)
    await rm(envPath, { force: true })
  }
}

async function acceptMarketing(baseUrl: string, evidence: string, facts: Record<string, unknown>): Promise<void> {
  const browser = await chromium.launch({ headless: true })
  const errors: string[] = []
  try {
    for (const [name, viewport, reduced] of [
      ['desktop', { width: 1440, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true],
    ] as const) {
      const context = await browser.newContext({ viewport, colorScheme: 'dark', reducedMotion: reduced ? 'reduce' : 'no-preference', ignoreHTTPSErrors: true })
      const page = await context.newPage()
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(baseUrl, { waitUntil: 'networkidle' })
      await page.screenshot({ path: path.join(evidence, `marketing-${name}-dark.png`), fullPage: true })
      await page.getByRole('button', { name: /switch to/i }).click()
      await page.screenshot({ path: path.join(evidence, `marketing-${name}-light.png`), fullPage: true })
      if (name === 'mobile') { await page.getByRole('button', { name: 'Open menu' }).click(); await page.getByRole('dialog', { name: 'Mobile navigation' }).waitFor() }
      await page.goto(`${baseUrl}/community`, { waitUntil: 'networkidle' })
      await page.locator('[data-film]').first().click()
      await page.locator('dialog video, [role="dialog"] video').first().waitFor()
      await context.close()
    }
  } finally { await browser.close() }
  if (errors.length) throw new Error(`Chromium console errors: ${errors.join(' | ')}`)
  facts.marketing = { desktop: 'light/dark', mobile: 'light/dark/reduced-motion/menu', community: 'dialog playback', consoleErrors: 0 }
}

async function acceptMedia(baseUrl: string, facts: Record<string, unknown>): Promise<void> {
  const media: unknown[] = []
  for (const film of communityFilms) {
    const local = await readFile(path.join(root, 'public', film.videoSrc))
    const response = await insecureFetch(`${baseUrl}${film.videoSrc}`)
    const range = await insecureFetch(`${baseUrl}${film.videoSrc}`, { Range: 'bytes=0-31' })
    verifyMediaRange({ fullHash: sha256(response.body), localHash: sha256(local), status: range.status, contentRange: range.headers['content-range'] ?? null, bytes: range.body.length })
    const ffprobe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(root, 'public', film.videoSrc)])
    media.push({ slug: film.slug, sha256: sha256(local), ffprobeDuration: Number(ffprobe.trim()), range: 206 })
  }
  facts.media = media
}

async function acceptAdmin(baseUrl: string, ownerPassword: string, env: Record<string, string>, facts: Record<string, unknown>, secrets: string[]): Promise<void> {
  const adminEmail = `acceptance-admin-${randomBytes(6).toString('hex')}@purpleink.local`
  await run('pnpm', ['tsx', 'scripts/setup/seed-owner-account.ts', '--email', adminEmail, '--password', ownerPassword, '--workspace', 'new'], { ...process.env, DATABASE_URL: `postgres://cvc:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.PREDEV_POSTGRES_PORT}/cvc`, CVC_CREDENTIAL_MASTER_KEY: env.CVC_CREDENTIAL_MASTER_KEY })
  await run('pnpm', ['admin:set-role', '--email', adminEmail, '--role', 'admin'], { ...process.env, DATABASE_URL: `postgres://cvc:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.PREDEV_POSTGRES_PORT}/cvc` })
  const admin = await session(baseUrl, adminEmail, ownerPassword)
  const regularPassword = secret()
  const regularEmail = `acceptance-user-${randomBytes(6).toString('hex')}@purpleink.local`
  secrets.push(regularPassword)
  const created = await json(admin, '/api/admin/users', 'POST', { email: regularEmail, name: 'Acceptance User', password: regularPassword, workspaceName: 'Acceptance Workspace' })
  const user = await session(baseUrl, regularEmail, regularPassword)
  const targets = ['/admin', '/admin/users', '/admin/jobs', '/admin/ops', '/admin/security', '/admin/ai', '/admin/billing', '/api/admin/users', '/api/admin/jobs', '/api/admin/ops', '/api/admin/security', '/api/admin/ai', '/api/admin/billing']
  const matrix = await Promise.all(targets.map(async target => ({ target, unauthenticated: await httpsStatus(`${baseUrl}${target}`), user: await status(user, target), admin: await status(admin, target) })))
  verifyAdminGuardMatrix(matrix)
  const batch = await json(admin, '/api/admin/billing/batches', 'POST', { planKey: 'plus', label: 'acceptance', count: 1 })
  const code = (batch.codes as string[])[0]
  if (!code) throw new Error('redemption batch did not return one-time plaintext code')
  secrets.push(code)
  await json(user, '/api/billing/redemptions', 'POST', { code, idempotencyKey: randomUUID() }, { 'idempotency-key': randomUUID() })
  await json(admin, `/api/admin/billing/batches/${String(batch.id)}`, 'PATCH', { action: 'revoke', confirmation: 'REVOKE' })
  const userId = String((created.user as { id: string }).id)
  await json(admin, `/api/admin/users/${userId}`, 'DELETE', { confirmation: 'DISABLE' })
  if (await status(user, '/api/billing') !== 401) throw new Error('disabled account retained its old session')
  await json(admin, `/api/admin/users/${userId}`, 'PATCH', { status: 'active' })
  if (await status(user, '/api/billing') !== 401) throw new Error('restored account revived a revoked old session')
  const restored = await session(baseUrl, regularEmail, regularPassword)
  if (await status(restored, '/api/billing') !== 200) throw new Error('restored account could not establish a new session')
  const own = await response(admin, `/api/admin/users/${await currentAdminId(admin, adminEmail)}`, 'DELETE', { confirmation: 'DISABLE' })
  if (own.status !== 400 || (own.body as { code?: unknown }).code !== 'SELF_DISABLE') throw new Error('self-disable guard failed')
  await assertRedactedResponses(admin, secrets)
  await restored.dispose()
  await admin.dispose(); await user.dispose()
  facts.admin = { guards: matrix, sessionDisabledRestore: 'disabled session invalidated; restore required a new login', selfDisable: 'SELF_DISABLE', redemption: 'plaintext once, redeemed, revoked', responses: 'redaction checked' }
}

async function acceptRuntime(project: string, envFile: string, facts: Record<string, unknown>): Promise<void> {
  const config = await docker(project, envFile, ['config', '--format', 'json'])
  const parsed = JSON.parse(config) as { networks: Record<string, { name: string }>; volumes: Record<string, { name: string }>; services: Record<string, { ports?: { host_ip?: string; target?: number }[] }> }
  verifyComposeIsolation({
    networks: Object.values(parsed.networks).map(network => network.name), volumes: Object.values(parsed.volumes).map(volume => volume.name),
    ports: Object.entries(parsed.services).flatMap(([service, value]) => (value.ports ?? []).map(port => ({ service, hostIp: port.host_ip ?? '', target: port.target ?? 0 }))),
  }, project)
  const worker = await docker(project, envFile, ['exec', '-T', 'worker', 'node', '-e', "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1))"])
  facts.runtime = { composeProject: project, engineHealth: worker.trim() || 'ok', caddyOnlyPublishedPort: true, networks: 'compose config inspected' }
}

async function session(baseUrl: string, email: string, password: string): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true })
  const response = await api.post('/api/auth/login', { data: { email, password } })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  return api
}
async function json(api: APIRequestContext, url: string, method: 'POST' | 'PATCH' | 'DELETE', data: unknown, headers?: Record<string, string>): Promise<Record<string, unknown>> { const result = await response(api, url, method, data, headers); if (result.status < 200 || result.status >= 300) throw new Error(`${url}: ${result.status}`); return result.body }
async function response(api: APIRequestContext, url: string, method: 'POST' | 'PATCH' | 'DELETE', data: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> { const result = await api.fetch(url, { method, data, headers }); return { status: result.status(), body: await result.json() as Record<string, unknown> } }
async function status(api: APIRequestContext, url: string): Promise<number> { return (await api.get(url)).status() }
async function currentAdminId(api: APIRequestContext, email: string): Promise<string> { const users = await api.get(`/api/admin/users?q=${encodeURIComponent(email)}`); const body = await users.json() as { items?: { id?: unknown; email?: unknown }[] }; const item = body.items?.find(row => row.email === email); if (typeof item?.id !== 'string') throw new Error('seed admin missing from admin users projection'); return item.id }
async function assertRedactedResponses(api: APIRequestContext, secrets: readonly string[]): Promise<void> { for (const endpoint of ['/api/admin/jobs', '/api/admin/ops', '/api/admin/ai', '/api/admin/billing']) { const result = await api.get(endpoint); if (!result.ok()) throw new Error(`${endpoint}: ${result.status()}`); const payload = JSON.stringify(await result.json()); if (secrets.some(secret => secret && payload.includes(secret))) throw new Error(`${endpoint} returned a generated secret`) } }
async function docker(project: string, envFile: string, args: string[]): Promise<string> { return run('docker', [...compose, '--project-name', project, '--env-file', envFile, ...args]) }
async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve)); const address = server.address(); server.close(); return typeof address === 'object' && address ? address.port : Promise.reject(new Error('no port')) }
async function waitFor(check: () => Promise<number>, expected: number): Promise<void> { for (let i = 0; i < 60; i += 1) { if (await check().catch(() => 0) === expected) return; await new Promise(resolve => setTimeout(resolve, 1000)) } throw new Error('service did not become ready') }
async function httpsStatus(url: string): Promise<number> { return (await insecureFetch(url)).status }
async function verifiedImages(commit: string) {
  const names = { web: 'purpleink-web:verify-predev', worker: 'purpleink-worker:verify-predev', migrate: 'purpleink-migrate:verify-predev' }
  const entries = await Promise.all(Object.entries(names).map(async ([key, image]) => {
    const revision = await run('docker', ['image', 'inspect', image, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}']).catch(() => '')
    return [key, { image, revision: revision.trim() || null }] as const
  }))
  return selectVerifiedImages(commit, Object.fromEntries(entries) as Parameters<typeof selectVerifiedImages>[1])
}
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
async function writeEvidence(directory: string, commit: string, baseUrl: string, project: string, secrets: string[], facts: unknown): Promise<void> { await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(createEvidenceManifest({ commit, baseUrl, composeProject: project, secretValues: secrets, facts }), null, 2)}\n`, 'utf8') }
function run(command: string, args: string[], env = process.env): Promise<string> {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', data => { stdout += data })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} failed (${code})`)))
  })
}
function redactMessage(message: string, secrets: readonly string[]): string { return secrets.reduce((result, secret) => secret ? result.replaceAll(secret, '[REDACTED]') : result, message) }
function insecureFetch(url: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { rejectUnauthorized: false, headers }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])),
        body: Buffer.concat(chunks),
      }))
    })
    request.on('error', reject)
    request.end()
  })
}
void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
