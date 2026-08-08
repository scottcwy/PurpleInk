import type { NarrationMode } from './contracts'
import type { CliProvider } from './config'
import { SafeCliError } from './safe-error'

export type CliCommand =
  | 'run'
  | 'plan'
  | 'transcribe'
  | 'submit'
  | 'daemon'
  | 'status'
  | 'inspect'
  | 'retry'
  | 'cancel'
  | 'serve'
  | 'doctor'
  | 'help'
  | 'config'
  | 'voice'
export type ConfigAction = 'set' | 'show' | 'verify'
export type ConfigTarget = 'text' | 'speech' | 'all'
export type VoiceAction = 'import' | 'use' | 'list'
export type DaemonAction = 'start' | 'status' | 'stop' | 'worker'

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
  configTarget?: ConfigTarget
  configUrl?: string
  configModel?: string
  configTtsModel?: string
  configAsrModel?: string
  keyStdin?: boolean
  voiceAction?: VoiceAction
  voiceName?: string
  voiceSamplePath?: string
  inputPaths?: string[]
  watch?: boolean
  shotId?: string
  retryFailed?: boolean
  daemonAction?: DaemonAction
  serveWithDaemon?: boolean
  port?: number
  live?: boolean
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [first, ...rest] = argv
  if (first === 'config') return parseConfigArgs(rest)
  if (first === 'voice') return parseVoiceArgs(rest)
  if (first === 'daemon') return parseDaemonArgs(rest)
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
    if (!flag.startsWith('--') && command === 'submit') {
      result.inputPaths = [...(result.inputPaths ?? []), flag]
      continue
    }
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
    if (flag === '--watch' && command === 'status') {
      result.watch = true
      continue
    }
    if (flag === '--shot' && (command === 'inspect' || command === 'retry')) {
      result.shotId = parseShotId(takeValue(rest, ++index, flag))
      continue
    }
    if (flag === '--failed' && command === 'retry') {
      result.retryFailed = true
      continue
    }
    if (flag === '--port' && command === 'serve') {
      result.port = parseInteger(takeValue(rest, ++index, flag), flag, 0, 65_535)
      continue
    }
    if (flag === '--live' && command === 'doctor') {
      result.live = true
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
  if (
    (result.command === 'inspect' ||
      result.command === 'retry' ||
      result.command === 'cancel' ||
      result.command === 'serve') &&
    result.inputPath &&
    !result.resumeDir
  ) {
    result.resumeDir = result.inputPath
    result.inputPath = undefined
  }
  if (result.command === 'submit' && !result.inputPaths?.length) {
    throw new SafeCliError('INPUT_REQUIRED', 'submit 至少需要一个输入文件。', false, 400)
  }
  if (result.command === 'retry' && result.shotId && result.retryFailed) {
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'retry 的 --shot 与 --failed 不能同时使用。', false, 400)
  }
  return result
}

function parseDaemonArgs(args: readonly string[]): CliArgs {
  const action = parseDaemonAction(args[0])
  const result: CliArgs = {
    command: 'daemon',
    inputPath: undefined,
    outputDir: undefined,
    resumeDir: undefined,
    concurrency: undefined,
    narration: undefined,
    json: false,
    skipBrowserGate: false,
    provider: undefined,
    daemonAction: action,
  }
  for (const flag of args.slice(1)) {
    if (flag === '--json') result.json = true
    else if (flag === '--serve' && (action === 'start' || action === 'worker')) result.serveWithDaemon = true
    else throw new SafeCliError('CLI_ARGUMENT_INVALID', 'daemon 命令参数无效。', false, 400)
  }
  return result
}

function parseConfigArgs(args: readonly string[]): CliArgs {
  const action = parseConfigAction(args[0])
  const target = action === 'show' ? undefined : parseConfigTarget(args[1], action)
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
    if (flag === '--tts-model' && action === 'set') {
      result.configTtsModel = takeValue(args, ++index, flag)
      continue
    }
    if (flag === '--asr-model' && action === 'set') {
      result.configAsrModel = takeValue(args, ++index, flag)
      continue
    }
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'config 命令参数无效。', false, 400)
  }
  if (action === 'set' && target === 'text' && (!result.configUrl || !result.configModel)) {
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'config set text 需要 --url 和 --model。', false, 400)
  }
  if (
    action === 'set' &&
    target === 'speech' &&
    (!result.configUrl || !result.configTtsModel || !result.configAsrModel)
  ) {
    throw new SafeCliError(
      'CLI_ARGUMENT_INVALID',
      'config set speech 需要 --url、--tts-model 和 --asr-model。',
      false,
      400,
    )
  }
  return result
}

function parseVoiceArgs(args: readonly string[]): CliArgs {
  const action = parseVoiceAction(args[0])
  const result: CliArgs = {
    command: 'voice',
    inputPath: undefined,
    outputDir: undefined,
    resumeDir: undefined,
    concurrency: undefined,
    narration: undefined,
    json: false,
    skipBrowserGate: false,
    provider: undefined,
    voiceAction: action,
  }
  let flagStart = 1
  if (action === 'import') {
    result.voiceSamplePath = requirePositional(args[1], 'voice import 需要样音路径。')
    flagStart = 2
  } else if (action === 'use') {
    result.voiceName = requirePositional(args[1], 'voice use 需要 voice id。')
    flagStart = 2
  }
  for (let index = flagStart; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === '--json') {
      result.json = true
      continue
    }
    if (flag === '--name' && action === 'import') {
      result.voiceName = takeValue(args, ++index, flag)
      continue
    }
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'voice 命令参数无效。', false, 400)
  }
  if (action === 'import' && !result.voiceName) {
    throw new SafeCliError('CLI_ARGUMENT_INVALID', 'voice import 需要 --name。', false, 400)
  }
  return result
}

function parseCommand(value: string | undefined): CliCommand {
  if (!value || value === '--help' || value === '-h') return 'help'
  if (
    value === 'run' ||
    value === 'plan' ||
    value === 'transcribe' ||
    value === 'submit' ||
    value === 'status' ||
    value === 'inspect' ||
    value === 'retry' ||
    value === 'cancel' ||
    value === 'serve' ||
    value === 'doctor' ||
    value === 'help'
  )
    return value
  throw new Error(`未知 CLI 命令: ${value}`)
}

function parseConfigAction(value: string | undefined): ConfigAction {
  if (value === 'set' || value === 'show' || value === 'verify') return value
  throw new SafeCliError('CONFIG_ACTION_INVALID', 'config 只支持 set、show、verify。', false, 400)
}

function parseConfigTarget(value: string | undefined, action: ConfigAction): ConfigTarget {
  if (value === 'text' || value === 'speech') return value
  if (value === 'all' && action === 'verify') return value
  throw new SafeCliError('CONFIG_TARGET_INVALID', 'config 目标无效。', false, 400)
}

function parseVoiceAction(value: string | undefined): VoiceAction {
  if (value === 'import' || value === 'use' || value === 'list') return value
  throw new SafeCliError('VOICE_ACTION_INVALID', 'voice 只支持 import、use、list。', false, 400)
}

function parseDaemonAction(value: string | undefined): DaemonAction {
  if (value === 'start' || value === 'status' || value === 'stop' || value === 'worker') return value
  throw new SafeCliError('DAEMON_ACTION_INVALID', 'daemon 只支持 start、status、stop。', false, 400)
}

function parseShotId(value: string): string {
  if (!/^S\d{3}$/u.test(value)) throw new SafeCliError('CLI_ARGUMENT_INVALID', 'shot id 必须匹配 S###。', false, 400)
  return value
}

function requirePositional(value: string | undefined, message: string): string {
  if (!value || value.startsWith('--')) throw new SafeCliError('CLI_ARGUMENT_INVALID', message, false, 400)
  return value
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
