/* Runs the full PostgreSQL suite against a disposable local container. */
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createIsolatedPgTestEnvironment } from './isolated-pg-environment'

const ROOT = process.cwd()

function run(
  command: string,
  args: string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, env: environment as NodeJS.ProcessEnv, stdio: 'inherit' })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve('') : reject(new Error(`${command} ${args.join(' ')} failed (${code})`)))
  })
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await run('docker', ['exec', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAc', 'SELECT 1'])
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  throw new Error('temporary Postgres did not become ready')
}

async function main(): Promise<void> {
  const container = `purpleink-predev-full-pg-${randomBytes(6).toString('hex')}`
  let started = false
  try {
    await run('docker', ['run', '--detach', '--rm', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', '127.0.0.1::5432', 'postgres:17.5-alpine'])
    started = true
    await waitForPostgres(container)
    const portLine = (await new Promise<string>((resolve, reject) => {
      const child = spawn('docker', ['port', container, '5432/tcp'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] })
      let output = ''
      child.stdout.on('data', value => { output += String(value) })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error('temporary Postgres port unavailable')))
    }))
    const port = portLine.match(/:(\d+)$/m)?.[1]
    if (!port) throw new Error('temporary Postgres port unavailable')
    const environment = createIsolatedPgTestEnvironment(
      process.env,
      `postgres://postgres@127.0.0.1:${port}/postgres`,
    )
    await run('pnpm', ['test:pg'], environment)
  } finally {
    if (started) await run('docker', ['rm', '--force', container]).catch(() => undefined)
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
