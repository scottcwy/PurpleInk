import { resolve } from 'node:path'

import type { CliArgs } from '../args'
import { SafeCliError } from '../safe-error'
import type { VoiceStore } from './voice-store'

export async function executeVoiceCommand(args: CliArgs, store: VoiceStore): Promise<unknown> {
  if (args.command !== 'voice') throw new Error('voice command required')
  if (args.voiceAction === 'list') return store.list()
  if (args.voiceAction === 'use') {
    return store.use(requireValue(args.voiceName, 'voice use 需要 voice id。'))
  }
  if (args.voiceAction === 'import') {
    const source = resolve(
      process.env.INIT_CWD?.trim() || process.cwd(),
      requireValue(args.voiceSamplePath, '缺少样音路径。'),
    )
    const voice = await store.import(source, requireValue(args.voiceName, 'voice import 需要 --name。'))
    return { voice }
  }
  throw new SafeCliError('VOICE_ACTION_INVALID', 'voice 子命令无效。', false, 400)
}

function requireValue(value: string | undefined, message: string): string {
  if (!value) throw new SafeCliError('CLI_ARGUMENT_INVALID', message, false, 400)
  return value
}
