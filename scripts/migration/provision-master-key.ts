import { randomBytes, randomUUID } from 'node:crypto'
import {
  lstat,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { parseCredentialMasterKey } from '@/features/credentials/credential-envelope'

const KEY = 'CVC_CREDENTIAL_MASTER_KEY'

async function main(): Promise<void> {
  const envPath = parseArgs(process.argv.slice(2))
  const existing = await readOptional(envPath)
  const matches = findKeyAssignments(existing)
  if (matches.length > 1) throw new Error(`duplicate ${KEY} assignment`)
  if (matches.length === 1) {
    parseCredentialMasterKey(matches[0])
    assertInheritedMatches(matches[0])
    process.stdout.write('reused\n')
    return
  }
  if (process.env[KEY] !== undefined) {
    throw new Error(`${KEY} is inherited but missing from the authoritative env file`)
  }
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const separator = existing.length > 0 && !existing.endsWith('\n') ? newline : ''
  const updated = `${existing}${separator}${KEY}=${randomBytes(32).toString('base64')}${newline}`
  await atomicWrite(envPath, updated)
  process.stdout.write('created\n')
}

function parseArgs(args: string[]): string {
  if (args.length !== 2 || args[0] !== '--env' || !args[1]) {
    throw new Error('usage: provision-master-key --env .env.local')
  }
  return path.resolve(args[1])
}

function findKeyAssignments(content: string): string[] {
  if (content.includes('\uFFFD') || content.charCodeAt(0) === 0xfeff) {
    throw new Error('env file must be UTF-8 without BOM or replacement characters')
  }
  const values: string[] = []
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = /^(?:export\s+)?([^=\s]+)\s*=(.*)$/u.exec(trimmed)
    if (!match || match[1] !== KEY) continue
    const raw = match[2]!.trim()
    values.push(unquote(raw))
  }
  return values
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function assertInheritedMatches(persisted: string): void {
  const inherited = process.env[KEY]
  if (inherited === undefined) return
  parseCredentialMasterKey(inherited)
  if (inherited !== persisted) {
    throw new Error(`${KEY} does not match the authoritative env file`)
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.tmp-${randomUUID()}`,
  )
  const mode = await currentMode(target)
  try {
    await writeFile(temporary, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode,
    })
    await rename(temporary, target)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

async function currentMode(target: string): Promise<number> {
  try {
    return (await stat(target)).mode
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return 0o600
    throw error
  }
}

async function readOptional(target: string): Promise<string> {
  try {
    const details = await lstat(target)
    if (!details.isFile()) throw new Error('env target must be a regular file')
    return await readFile(target, 'utf8')
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return ''
    throw error
  }
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && !Array.isArray(error)
    && (error as Record<string, unknown>).code === code
}

main().catch(() => {
  process.exitCode = 1
})
