import type { NarrationMode } from './contracts'
import type { CliProvider } from './config'

export type CliCommand = 'run' | 'plan' | 'status' | 'doctor' | 'help'

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
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [first, ...rest] = argv
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
    if (flag === '--json') { result.json = true; continue }
    if (flag === '--no-browser-gate') { result.skipBrowserGate = true; continue }
    if (flag === '--input') { result.inputPath = takeValue(rest, ++index, flag); continue }
    if (flag === '--output') { result.outputDir = takeValue(rest, ++index, flag); continue }
    if (flag === '--resume' || flag === '--run') { result.resumeDir = takeValue(rest, ++index, flag); continue }
    if (flag === '--concurrency') { result.concurrency = parseInteger(takeValue(rest, ++index, flag), flag, 1, 32); continue }
    if (flag === '--narration') { result.narration = parseNarration(takeValue(rest, ++index, flag)); continue }
    if (flag === '--provider') { result.provider = parseProvider(takeValue(rest, ++index, flag)); continue }
    if (flag === '--help' || flag === '-h') { result.command = 'help'; continue }
    throw new Error(`未知 CLI 参数: ${flag}`)
  }
  if (result.command === 'status' && result.inputPath && !result.resumeDir) {
    result.resumeDir = result.inputPath
    result.inputPath = undefined
  }
  return result
}

function parseCommand(value: string | undefined): CliCommand {
  if (!value || value === '--help' || value === '-h') return 'help'
  if (value === 'run' || value === 'plan' || value === 'status' || value === 'doctor' || value === 'help') return value
  throw new Error(`未知 CLI 命令: ${value}`)
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
