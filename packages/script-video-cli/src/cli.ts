import { parseCliArgs, type CliArgs } from './args'
import { executeCliCommand } from './commands'
import { executeConfigCommand, type TextProviderVerifier } from './config-command'
import { loadLocalEnvFile, readEffectiveCliConfig } from './config'
import { WindowsCurrentUserDpapiProtector, type SecretProtector } from './dpapi'
import { LocalConfigStore, resolveLocalConfigPaths, type LocalConfigIo } from './local-config'
import { projectSafeError } from './safe-error'
import { createProcessSecretInput, type SecretInput } from './secret-input'

export { parseCliArgs }
export type { CliArgs }

export interface CliOutput {
  writeLine(line: string): void
}

export interface CliRuntimeOptions {
  localAppData?: string
  now?: () => Date
  configIo?: LocalConfigIo
  secretProtector?: SecretProtector
  secretInput?: SecretInput
  stdinIsTty?: boolean
  verifyTextProvider?: TextProviderVerifier
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  output: CliOutput = { writeLine: (line) => console.log(line) },
  runtime: CliRuntimeOptions = {},
): Promise<number> {
  let args: CliArgs | undefined
  const jsonRequested = argv.includes('--json')
  let command = inferCommandKey(argv)
  try {
    loadLocalEnvFile(env)
    args = parseCliArgs(argv)
    command = commandKey(args)
    const store = createLocalStore(env, runtime)
    const result =
      args.command === 'config'
        ? await executeConfigCommand(args, {
            store,
            secretInput: runtime.secretInput ?? createProcessSecretInput(),
            stdinIsTty: runtime.stdinIsTty ?? process.stdin.isTTY === true,
            verifyTextProvider: runtime.verifyTextProvider,
          })
        : await executeCliCommand(
            args,
            await readEffectiveCliConfig(env, process.cwd(), store, {
              provider: args.provider,
              loadTextSecret: args.command === 'run' || args.command === 'plan',
            }),
          )
    const runId = isRecord(result) && typeof result.runId === 'string' ? result.runId : undefined
    const envelope = { ok: true, command, ...(runId ? { runId } : {}), data: result }
    output.writeLine(args.json ? JSON.stringify(envelope) : formatHumanResult(result))
    return 0
  } catch (error) {
    const safeError = projectSafeError(error)
    const payload = { ok: false, command, error: safeError }
    output.writeLine(
      args?.json || jsonRequested ? JSON.stringify(payload) : `失败（${safeError.code}）：${safeError.message}`,
    )
    return 1
  }
}

function createLocalStore(env: NodeJS.ProcessEnv, runtime: CliRuntimeOptions): LocalConfigStore {
  return new LocalConfigStore(
    resolveLocalConfigPaths(env, runtime.localAppData),
    runtime.secretProtector ?? new WindowsCurrentUserDpapiProtector(),
    { io: runtime.configIo, now: runtime.now },
  )
}

function formatHumanResult(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'usage' in value && typeof value.usage === 'string')
    return value.usage
  if (isRecord(value) && typeof value.command === 'string') {
    if (value.command === 'run')
      return `run ${String(value.status)}\nrunDir: ${String(value.runDir)}\nvideo: ${String(value.videoPath)}`
    if (value.command === 'plan')
      return `plan completed\nrunDir: ${String(value.runDir)}\nshots: ${String(value.shots instanceof Array ? value.shots.length : 0)}`
    if (value.command === 'status')
      return `status ${isRecord(value.run) ? String(value.run.status) : 'unknown'}\nrunDir: ${isRecord(value.run) ? String(value.run.runDir) : 'unknown'}`
    if (value.command === 'doctor') return JSON.stringify(value, null, 2)
  }
  return JSON.stringify(value, null, 2)
}

function commandKey(args: CliArgs): string {
  if (args.command !== 'config') return args.command
  if (args.configAction === 'set') return 'config.set.text'
  if (args.configAction === 'verify') return 'config.verify.text'
  return 'config.show'
}

function inferCommandKey(argv: readonly string[]): string {
  if (argv[0] !== 'config') {
    return argv[0] === 'run' || argv[0] === 'plan' || argv[0] === 'status' || argv[0] === 'doctor' || argv[0] === 'help'
      ? argv[0]
      : 'help'
  }
  if (argv[1] === 'set') return 'config.set.text'
  if (argv[1] === 'verify') return 'config.verify.text'
  if (argv[1] === 'show') return 'config.show'
  return 'config'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const directCliExecution =
  process.argv.some((value) => /(?:^|[\\/])src[\\/]cli\.ts$/u.test(value)) && process.env.VITEST !== 'true'
if (directCliExecution) {
  void runCli().then((code) => {
    process.exitCode = code
  })
}
