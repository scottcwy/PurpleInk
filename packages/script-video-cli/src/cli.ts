import { parseCliArgs, type CliArgs } from './args'
import { executeCliCommand } from './commands'
import { loadLocalEnvFile, readCliConfig } from './config'

export { parseCliArgs }
export type { CliArgs }

export interface CliOutput {
  writeLine(line: string): void
}

export async function runCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  output: CliOutput = { writeLine: (line) => console.log(line) },
): Promise<number> {
  let args: CliArgs | undefined
  try {
    loadLocalEnvFile(env)
    args = parseCliArgs(argv)
    const config = readCliConfig(env)
    const result = await executeCliCommand(args, config)
    output.writeLine(args.json ? JSON.stringify({ ok: true, result }) : formatHumanResult(result))
    return 0
  } catch (error) {
    const code = errorCode(error)
    const payload = { ok: false, error: { code } }
    output.writeLine(
      args?.json ? JSON.stringify(payload) : `失败（${code}）。请运行 purpleink-video doctor 检查本地依赖。`,
    )
    return 1
  }
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

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'CLI_FAILED'
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
