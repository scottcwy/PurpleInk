import { describe, expect, it, vi } from 'vitest'
import { generateVoiceover } from './voiceover'

vi.mock('server-only', () => ({}))

describe('generateVoiceover', () => {
  it('synthesizes real speech and stores audio plus trusted metadata artifacts', async () => {
    const synthesize = vi.fn(async () => ({
      audioBytes: Buffer.from([1, 2, 3]),
      audioFormat: 'mp3' as const,
      durationMs: 760,
      model: 'stepaudio-2.5-tts',
      nativeCaptions: [
        { text: '你好', startMs: 0, endMs: 320 },
        { text: '世界', startMs: 320, endMs: 760 },
      ],
    }))
    const storeArtifact = vi.fn()
      .mockResolvedValueOnce({
        id: 'audio-artifact',
        storageKey: 'audio/project-1/S001/voiceover-audio-hash.mp3',
        contentHash: 'audio-hash',
      })
      .mockResolvedValueOnce({
        id: 'metadata-artifact',
        storageKey: 'audio/project-1/S001/voiceover-metadata-hash.json',
        contentHash: 'metadata-hash',
      })

    const result = await generateVoiceover(
      {
        projectId: 'project-1',
        nodeId: 'sfx-node',
        shotId: 'S001',
        text: '你好世界',
      },
      { synthesize, storeArtifact }
    )

    expect(synthesize).toHaveBeenCalledWith({
      text: '你好世界',
      voiceId: undefined,
    })
    expect(storeArtifact).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectId: 'project-1',
        nodeId: 'sfx-node',
        shotId: 'S001',
        kind: 'voiceover-audio',
        extension: 'mp3',
        data: Buffer.from([1, 2, 3]),
      })
    )
    const metadataWrite = storeArtifact.mock.calls[1]?.[0]
    expect(metadataWrite).toMatchObject({
      kind: 'voiceover-metadata',
      extension: 'json',
    })
    expect(JSON.parse(String(metadataWrite.data))).toMatchObject({
      model: 'stepaudio-2.5-tts',
      durationMs: 760,
      audioArtifactId: 'audio-artifact',
      nativeCaptions: [
        { text: '你好', startMs: 0, endMs: 320 },
        { text: '世界', startMs: 320, endMs: 760 },
      ],
    })
    expect(result).toEqual({
      kind: 'voiceover',
      status: 'ready',
      shotId: 'S001',
      model: 'stepaudio-2.5-tts',
      nativeCaptions: [
        { text: '你好', startMs: 0, endMs: 320 },
        { text: '世界', startMs: 320, endMs: 760 },
      ],
      track: {
        shotId: 'S001',
        audioArtifactId: 'audio-artifact',
        audioKey: 'audio/project-1/S001/voiceover-audio-hash.mp3',
        metadataArtifactId: 'metadata-artifact',
        metadataKey: 'audio/project-1/S001/voiceover-metadata-hash.json',
        durationMs: 760,
      },
    })
  })
})
