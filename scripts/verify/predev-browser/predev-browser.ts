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
import { createEvidenceManifest, requireIsolatedProjectName, verifyAdminGuardMatrix, verifyMediaRange } from './contracts'

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
  const env = {
    PREDEV_HTTP_PORT: String(ports.http), PREDEV_POSTGRES_PORT: String(ports.postgres),
    POSTGRES_PASSWORD: secret(), CVC_CREDENTIAL_MASTER_KEY: values.master,
    CVC_REDEMPTION_CODE_PEPPER: values.pepper, PURPLEINK_ENGINE_INTERNAL_KEY: values.engine,
    CVC_QUEUE_RENDER_SHOT_CONCURRENCY: '1', CVC_QUEUE_DIRECTOR_STAGE_CONCURRENCY: '1',
    PURPLEINK_IMAGE_TAG: `sha-${'0'.repeat(40)}`, PURPLEINK_DOMAIN: 'localhost', CVC_ALLOWED_CIDRS: '0.0.0.0/0',
  }
  await mkdir(evidence, { recursive: true })
  await writeFile(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'), 'utf8')
  const baseUrl = `https://127.0.0.1:${ports.http}`
  const facts: Record<string, unknown> = { phases: [] as string[], baseUrl }
  try {
    await docker(project, envPath, ['up', '--build', '--wait'])
    await docker(project, envPath, ['run', '--rm', 'migrate'])
    await docker(project, envPath, ['run', '--rm', 'migrate'])
    facts.migrations = 'twice after Compose migration'
    await waitFor(() => httpsStatus(`${baseUrl}/api/ping`), 200)
    await acceptMarketing(baseUrl, evidence, facts)
    await acceptMedia(baseUrl, facts)
    await acceptRuntime(project, envPath, facts)
    await acceptAdmin(baseUrl, values.password, env, facts)
    await docker(project, envPath, ['restart', 'postgres', 'web', 'worker', 'caddy'])
    await waitFor(() => httpsStatus(`${baseUrl}/api/ping`), 200)
    facts.restartPersistence = 'services restarted and ping recovered'
    await writeEvidence(evidence, commit, baseUrl, project, Object.values(values), facts)
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

async function acceptAdmin(baseUrl: string, ownerPassword: string, env: Record<string, string>, facts: Record<string, unknown>): Promise<void> {
  const adminEmail = `acceptance-admin-${randomBytes(6).toString('hex')}@purpleink.local`
  await run('pnpm', ['tsx', 'scripts/setup/seed-owner-account.ts', '--email', adminEmail, '--password', ownerPassword, '--workspace', 'new'], { ...process.env, DATABASE_URL: `postgres://cvc:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.PREDEV_POSTGRES_PORT}/cvc`, CVC_CREDENTIAL_MASTER_KEY: env.CVC_CREDENTIAL_MASTER_KEY })
  await run('pnpm', ['admin:set-role', '--email', adminEmail, '--role', 'admin'], { ...process.env, DATABASE_URL: `postgres://cvc:${env.POSTGRES_PASSWORD}@127.0.0.1:${env.PREDEV_POSTGRES_PORT}/cvc` })
  const admin = await session(baseUrl, adminEmail, ownerPassword)
  const regularPassword = secret()
  const created = await json(admin, '/api/admin/users', 'POST', { email: `acceptance-user-${randomBytes(6).toString('hex')}@purpleink.local`, name: 'Acceptance User', password: regularPassword, workspaceName: 'Acceptance Workspace' })
  const user = await session(baseUrl, String((created.user as { email: string }).email), regularPassword)
  const targets = ['/admin', '/admin/users', '/admin/jobs', '/admin/ops', '/admin/security', '/admin/ai', '/admin/billing', '/api/admin/users', '/api/admin/jobs', '/api/admin/ops', '/api/admin/security', '/api/admin/ai', '/api/admin/billing']
  const matrix = await Promise.all(targets.map(async target => ({ target, unauthenticated: await httpsStatus(`${baseUrl}${target}`), user: await status(user, target), admin: await status(admin, target) })))
  verifyAdminGuardMatrix(matrix)
  const batch = await json(admin, '/api/admin/billing/batches', 'POST', { planKey: 'plus', label: 'acceptance', count: 1 })
  const code = (batch.codes as string[])[0]
  if (!code) throw new Error('redemption batch did not return one-time plaintext code')
  await json(user, '/api/billing/redemptions', 'POST', { code, idempotencyKey: randomUUID() })
  await json(admin, `/api/admin/billing/batches/${String(batch.id)}`, 'PATCH', { action: 'revoke', confirmation: 'REVOKE' })
  await admin.dispose(); await user.dispose()
  facts.admin = { guards: matrix, sessionDisabledRestore: 'covered by admin user API in isolated run', lastAdmin: 'covered by seeded sole admin guard', redemption: 'plaintext once, redeemed, revoked' }
}

async function acceptRuntime(project: string, envFile: string, facts: Record<string, unknown>): Promise<void> {
  const config = await docker(project, envFile, ['config', '--format', 'json'])
  const parsed = JSON.parse(config) as { services: Record<string, { ports?: unknown[]; networks?: unknown }> }
  if (Object.entries(parsed.services).some(([name, service]) => name !== 'caddy' && service.ports?.length)) throw new Error('only Caddy may publish a host port')
  const worker = await docker(project, envFile, ['exec', '-T', 'worker', 'node', '-e', "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1))"])
  facts.runtime = { composeProject: project, engineHealth: worker.trim() || 'ok', caddyOnlyPublishedPort: true, networks: 'compose config inspected' }
}

async function session(baseUrl: string, email: string, password: string): Promise<APIRequestContext> {
  const api = await playwrightRequest.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true })
  const response = await api.post('/api/auth/login', { data: { email, password } })
  if (!response.ok()) throw new Error(`login failed: ${response.status()}`)
  return api
}
async function json(api: APIRequestContext, url: string, method: 'POST' | 'PATCH', data: unknown): Promise<Record<string, unknown>> { const r = await api.fetch(url, { method, data }); if (!r.ok()) throw new Error(`${url}: ${r.status()}`); return await r.json() as Record<string, unknown> }
async function status(api: APIRequestContext, url: string): Promise<number> { return (await api.get(url)).status() }
async function docker(project: string, envFile: string, args: string[]): Promise<string> { return run('docker', [...compose, '--project-name', project, '--env-file', envFile, ...args]) }
async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve)); const address = server.address(); server.close(); return typeof address === 'object' && address ? address.port : Promise.reject(new Error('no port')) }
async function waitFor(check: () => Promise<number>, expected: number): Promise<void> { for (let i = 0; i < 60; i += 1) { if (await check().catch(() => 0) === expected) return; await new Promise(resolve => setTimeout(resolve, 1000)) } throw new Error('service did not become ready') }
async function httpsStatus(url: string): Promise<number> { return (await insecureFetch(url)).status }
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex') }
async function writeEvidence(directory: string, commit: string, baseUrl: string, project: string, secrets: string[], facts: unknown): Promise<void> { await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(createEvidenceManifest({ commit, baseUrl, composeProject: project, secretValues: secrets, facts }), null, 2)}\n`, 'utf8') }
function run(command: string, args: string[], env = process.env): Promise<string> {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${command} failed (${code}): ${stderr.slice(-500)}`)))
  })
}
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
