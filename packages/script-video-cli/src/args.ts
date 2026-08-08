import type { NarrationMode } from './contracts'
import type { CliProvider } from './config'
import { SafeCliError } from './safe-error'

export type CliCommand = 'run' | 'plan' | 'status' | 'doctor' | 'help' | 'config'
export type ConfigAction = 'set' | 'show' | 'verify'

export interface CliArgs {
  command: CliCommand
  inputPath: string | undefined
  outputDir: string | undefined
  resumeDir: string | undefined
  concurrency: number | undefined
  narration: NarrationMode | undefined
  json: boolean
  skipBrowserGate: boolean
  provider: CliProvider | undefined
  configAction?: ConfigAction
  configTarget?: 'text'
  configUrl?: string
  configModel?: string
  keyStdin?: boolean
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [first, ...rest] = argv
  if (first === 'config') return parseConfigArgs(rest)
  const command = parseCommand(first)
  const result: CliArgs = {
    command,
    inputPath: undefined,
    outputDir: undefined,
    resumeDir: undefined,
    concurrency: undefined,
    narration: undefined,
    json: false,
    skipBrowserGate: false,
    provider: undefined,
  }
  let positionalInput = false
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index]
    if (!flag) continue
    if (!flag.startsWith('--') && !positionalInput) {
      result.inputPath = flag
      positionalInput = true
      continue
    }
    if (flag === '--json') {
      result.json = true
      continue
    }
    if (flag === '--no-browser-gate') {
      result.skipBrowserGate = true
      continue
    }
    if (flag === '--input') {
      result.inputPath = takeValue(rest, ++index, flag)
      continue
    }
    if (flag === '--output') {
      result.outputDir = takeValue(rest, ++index, flag)
      continue
    }
    if (flag === '--resume' || flag === '--run') {
      result.resumeDir = takeValue(rest, ++index, flag)
      continue
    }
    if (flag === '--concurrency') {
      result.concurrency = parseInteger(takeValue(rest, ++index, flag), flag, 1, 32)
      continue
    }
    if (flag === '--narration') {
      result.narration = parseNarration(takeValue(rest, ++index, flag))
      continue
    }
    if (flag === '--provider') {
      result.provider = parseProvider(takeValue(rest, ++index, flag))
      continue
    }
    if (flag === '--help' || flag === '-h') {
      result.command = 'help'
      continue
    }
    throw new Error(`未知 CLI 参数: ${flag}`)
  }
  if (result.command === 'status' && result.inputPath && !result.resumeDir) {
    result.resumeDir = result.inputPath
    result.inputPath = undefined
  }
  return result
}

function parseConfigArgs(args: readonly string[]): CliArgs {
  const action = parseConfigAction(args[0])
  const target = action === 'show' ? undefined : parseConfigTarget(args[1])
  const result: CliArgs = {
    command: 'config',
    inputPath: undefined,
    outputDir: undefined,
    resumeDir: undefined,
    concurrency: undefined,
    narration: undefined,
    json: false,
    skipBrowserGate: false,
    provider: undefined,
    configAction: action,
    ...(target ? { configTarget: target } : {}),
    keyStdin: false,
  }
  const flagStart = action === 'show' ? 1 : 2
  for (let index = flagStart; index < args.length; index += 1) {
    const flag = args[index]
    if (!flag) continue
    if (flag === '--json') {
      result.json = true
      continue
    }
    if (flag === '--api-key') {
      throw new SafeCliError('KEY_ARGUMENT_FORBIDDEN', '禁止通过 --api-key 传递密钥；请使用 --key-stdin。', false, 400)
    }
    if (flag === '--key-stdin' && action === 'set') {
      result.keyStdin = true
      continue
    }
    if (flag === '--url' && action === 'set') {
      result.configUrl = takeValue(args, ++index, flag)
      continue
    }
    if (flag === '--model' && action === 'set') {
      result.configModel = takeValue(args, ++index, flag)
      continue
    }
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'config 命令参数无效。', false, 400)
  }
  if (action === 'set' && (!result.configUrl || !result.configModel)) {
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'config set text 需要 --url 和 --model。', false, 400)
  }
  return result
}

function parseCommand(value: string | undefined): CliCommand {
  if (!value || value === '--help' || value === '-h') return 'help'
  if (value === 'run' || value === 'plan' || value === 'status' || value === 'doctor' || value === 'help') return value
  throw new Error(`未知 CLI 命令: ${value}`)
}

function parseConfigAction(value: string | undefined): ConfigAction {
  if (value === 'set' || value === 'show' || value === 'verify') return value
  throw new SafeCliError('CONFIG_ACTION_INVALID', 'config 只支持 set、show、verify。', false, 400)
}

function parseConfigTarget(value: string | undefined): 'text' {
  if (value === 'text') return value
  throw new SafeCliError('CONFIG_TARGET_INVALID', '当前 config 目标只支持 text。', false, 400)
}

function takeValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`)
  return value
}

function parseInteger(value: string, flag: string, min: number, max: number): number {
  const result = Number(value)
  if (!Number.isInteger(result) || result < min || result > max) throw new Error(`${flag} 必须是 ${min}-${max} 的整数`)
  return result
}

function parseNarration(value: string): NarrationMode {
  if (value === 'off' || value === 'auto' || value === 'required') return value
  throw new Error('--narration 只支持 off、auto、required')
}

function parseProvider(value: string): CliProvider {
  if (value === 'fixture' || value === 'openai-compatible') return value
  throw new Error('--provider 只支持 fixture、openai-compatible')
}
