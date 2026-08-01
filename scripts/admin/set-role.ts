import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function installServerOnlyShim(): void {
  const stubPath = require.resolve('../setup/server-only-stub.js')
  const Module = require('node:module') as typeof import('node:module')
  const target = Module as unknown as {
    _resolveFilename: (...args: unknown[]) => string
  }
  const original = target._resolveFilename
  target._resolveFilename = function (
    request: unknown,
    ...rest: unknown[]
  ): string {
    if (request === 'server-only') return stubPath
    return original.call(this, request, ...rest)
  }
}

function option(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null
}

async function main(): Promise<void> {
  installServerOnlyShim()
  const [{ loadEnvConfig }, admin] = await Promise.all([
    import('@next/env'),
    import('@/features/admin'),
  ])
  loadEnvConfig(process.cwd())

  const argv = process.argv.slice(2)
  const email = option(argv, '--email')?.trim()
  const role = option(argv, '--role')
  if (!email || (role !== 'admin' && role !== 'user')) {
    throw new Error('用法：pnpm admin:set-role --email <email> --role admin|user')
  }

  const result = await admin.setGlobalUserRole({ email, role })
  process.stdout.write(
    `[admin:set-role] ${email.toLowerCase()}: ${result.previousRole} -> ${result.role}\n`,
  )
  process.exit(0)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[admin:set-role] fatal: ${message}\n`)
  process.exitCode = 1
})
