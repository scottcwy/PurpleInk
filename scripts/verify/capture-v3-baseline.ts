/**
 * 用途：顺序执行 Refactor v3 基线命令并写出脱敏、机器可读的证据。
 * 参数：无。
 * 退出码：全部命令成功时为 0；任一命令失败时先写证据，再返回 1。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { ACTIVE_WORKFLOW_VERSION } from '../../src/lib/workflow/version'

interface CommandEvidence {
  command: string
  exitCode: number
  durationMs: number
  stdoutSha256: string
  lastLines: readonly string[]
}

interface BaselineEvidenceV1 {
  schemaVersion: 1
  capturedAt: string
  branch: string
  commit: string
  workflowVersion: typeof ACTIVE_WORKFLOW_VERSION
  commands: readonly CommandEvidence[]
}

interface CommandSpec {
  display: string
  executable: string
  args: readonly string[]
  useCommandShell?: boolean
}

interface CommandResult {
  evidence: CommandEvidence
  stdout: string
}

const ROOT = resolve(import.meta.dirname, '../..')
const EVIDENCE_RELATIVE_PATH = 'docs/evidence/refactor-v3/n0-baseline.json'
const EVIDENCE_PATH = resolve(
  ROOT,
  EVIDENCE_RELATIVE_PATH
)
const MAX_BUFFER_BYTES = 16 * 1024 * 1024
const ANSI_ESCAPE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const AUTHORIZATION_HEADER =
  /\b(?:Authorization|Proxy-Authorization)\s*[:=]\s*[^\r\n]+/gi
const COOKIE_HEADER = /\b(?:Set-Cookie|Cookie)\s*[:=]\s*[^\r\n]+/gi
const SECRET_ASSIGNMENT =
  /\b([A-Z0-9_.-]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|DSN|CONNECTION_STRING|DATABASE_URL)[A-Z0-9_.-]*)\s*[:=]\s*([^\s,;]+)/gi
const URI_SECRET_PARAMETER =
  /([?&](?:api[_-]?key|token|access[_-]?token|signature|sig|password|secret|auth)=)[^&#\s]+/gi
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g
const ABSOLUTE_WINDOWS_PATH_LINE =
  /(?:\\\\\?\\)?[A-Z]:[\\/].*$/gim
const UNC_PATH_LINE = /\\\\[^\\\s]+\\[^\\\s]+.*$/gm
const HIGH_ENTROPY_TOKEN = /\b[A-Z0-9_-]{24,}\b/gi

const COMMANDS: readonly CommandSpec[] = [
  {
    display: 'git rev-parse --abbrev-ref HEAD',
    executable: 'git',
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
  },
  {
    display: 'git rev-parse HEAD',
    executable: 'git',
    args: ['rev-parse', 'HEAD'],
  },
  { display: 'node --version', executable: 'node', args: ['--version'] },
  {
    display: 'pnpm --version',
    executable: 'pnpm.cmd',
    args: ['--version'],
    useCommandShell: true,
  },
  {
    display: 'pnpm lint',
    executable: 'pnpm.cmd',
    args: ['lint'],
    useCommandShell: true,
  },
  {
    display: 'pnpm typecheck',
    executable: 'pnpm.cmd',
    args: ['typecheck'],
    useCommandShell: true,
  },
  {
    display: 'pnpm test',
    executable: 'pnpm.cmd',
    args: ['test'],
    useCommandShell: true,
  },
  {
    display: 'pnpm build',
    executable: 'pnpm.cmd',
    args: ['build'],
    useCommandShell: true,
  },
]

function secretValues(): readonly string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => {
      return (
        /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i.test(name) &&
        typeof value === 'string' &&
        value.length >= 4
      )
    })
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length)
}

export function redactBaselineOutput(text: string): string {
  let redacted = text
    .replace(ANSI_ESCAPE, '')
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED_PRIVATE_KEY]')
    .replace(AUTHORIZATION_HEADER, 'Authorization=[REDACTED]')
    .replace(COOKIE_HEADER, 'Cookie=[REDACTED]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT, '$1=[REDACTED]')
    .replace(URI_SECRET_PARAMETER, '$1[REDACTED]')
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, '://[REDACTED]@')
    .replace(ABSOLUTE_WINDOWS_PATH_LINE, '[ABSOLUTE_PATH]')
    .replace(UNC_PATH_LINE, '[ABSOLUTE_PATH]')
    .replace(HIGH_ENTROPY_TOKEN, '[REDACTED_TOKEN]')

  for (const value of secretValues()) {
    redacted = redacted.split(value).join('[REDACTED]')
  }
  return redacted
}

function boundedLastLines(stdout: string, stderr: string): readonly string[] {
  const combined = redactBaselineOutput(
    [stdout, stderr].filter(Boolean).join('\n')
  )
  return combined
    .split(/\r?\n/)
    .map((line) => line.slice(0, 500))
    .filter((line) => line.length > 0)
    .slice(-20)
}

function spawnArguments(spec: CommandSpec): {
  executable: string
  args: readonly string[]
} {
  if (!spec.useCommandShell) {
    return { executable: spec.executable, args: spec.args }
  }
  return {
    executable: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', spec.executable, ...spec.args],
  }
}

function runCommand(spec: CommandSpec): CommandResult {
  const startedAt = performance.now()
  const invocation = spawnArguments(spec)
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  })
  const durationMs = Math.round(performance.now() - startedAt)
  const stdout = result.stdout ?? ''
  const errorText = result.error instanceof Error ? result.error.message : ''
  const stderr = [result.stderr ?? '', errorText].filter(Boolean).join('\n')

  return {
    stdout,
    evidence: {
      command: spec.display,
      exitCode: result.status ?? 1,
      durationMs,
      stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
      lastLines: boundedLastLines(stdout, stderr),
    },
  }
}

function writeEvidence(results: readonly CommandResult[]): void {
  const evidence: BaselineEvidenceV1 = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    branch: results[0]?.stdout.trim() || 'unknown',
    commit: results[1]?.stdout.trim() || 'unknown',
    workflowVersion: ACTIVE_WORKFLOW_VERSION,
    commands: results.map(({ evidence: command }) => command),
  }

  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true })
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

function main(): void {
  const results = COMMANDS.map(runCommand)
  writeEvidence(results)

  for (const { evidence } of results) {
    console.log(`${evidence.exitCode === 0 ? 'PASS' : 'FAIL'} ${evidence.command}`)
  }
  console.log(`Evidence: ${EVIDENCE_RELATIVE_PATH}`)

  if (results.some(({ evidence }) => evidence.exitCode !== 0)) {
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
