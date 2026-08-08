import { describe, expect, it } from 'vitest'

import { CLI_VERSION, createCli } from './index'

describe('script-video-cli boundary', () => {
  it('exports a stable version and CLI factory', () => {
    expect(CLI_VERSION).toBe('script-video-cli-v1')
    expect(createCli()).toEqual({
      name: 'purpleink-video',
      version: CLI_VERSION,
    })
  })
})
