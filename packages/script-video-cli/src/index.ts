export const CLI_VERSION = 'script-video-cli-v1' as const

export interface CliDescriptor {
  name: 'purpleink-video'
  version: typeof CLI_VERSION
}

export function createCli(): CliDescriptor {
  return {
    name: 'purpleink-video',
    version: CLI_VERSION,
  }
}
