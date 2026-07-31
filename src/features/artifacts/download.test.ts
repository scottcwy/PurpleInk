import { describe, expect, it, vi } from 'vitest'
import {
  artifactDownloadFilename,
  attachmentDisposition,
  wantsAttachment,
} from './download'

vi.mock('server-only', () => ({}))

describe('artifactDownloadFilename', () => {
  it('names a final video by kind and content hash prefix', () => {
    // 哈希前缀与页面展示的 sha256:… 同源，用户下完文件可以直接对上。
    expect(
      artifactDownloadFilename({
        kind: 'final-mp4',
        contentHash: '8d21f3a4b5c6d7e8f9012345678901234567890123456789012345678901abcd',
      })
    ).toBe('final-mp4-8d21f3a4b5c6.mp4')
  })

  it('maps every known content type to its real extension', () => {
    expect(
      artifactDownloadFilename({ kind: 'narration-audio:U001', contentHash: null })
    ).toBe('narration-audio-u001.mp3')
    expect(
      artifactDownloadFilename({ kind: 'subtitle-track', contentHash: null })
    ).toBe('subtitle-track.json')
    expect(
      artifactDownloadFilename({ kind: 'frame-thumbnail', contentHash: null })
    ).toBe('frame-thumbnail.png')
    expect(
      artifactDownloadFilename({ kind: 'director-fabricate', contentHash: null })
    ).toBe('director-fabricate.html')
    expect(
      artifactDownloadFilename({ kind: 'placeholder-mp4', contentHash: null })
    ).toBe('placeholder-mp4.mp4')
  })

  it('stays ASCII and drops an untrustworthy hash', () => {
    const name = artifactDownloadFilename({
      kind: '成片 / final??',
      contentHash: 'not-a-hex-digest',
    })
    expect(name).toBe('final.bin')
    expect(name).toMatch(/^[a-z0-9.-]+$/u)
  })

  it('never emits header-breaking characters', () => {
    for (const kind of ['a"b', "a\r\nb", 'a;b', '../../etc/passwd']) {
      const filename = artifactDownloadFilename({ kind, contentHash: null })
      expect(filename).not.toMatch(/["\r\n;/\\]/u)
      expect(attachmentDisposition(filename)).toMatch(
        /^attachment; filename="[a-z0-9.-]+"$/u
      )
    }
  })
})

describe('wantsAttachment', () => {
  it('only opts in on an explicit truthy flag', () => {
    expect(wantsAttachment('1')).toBe(true)
    expect(wantsAttachment('true')).toBe(true)
    // 缺参数必须保持内联：画布检查器与成片预览都依赖内联播放。
    expect(wantsAttachment(null)).toBe(false)
    expect(wantsAttachment('')).toBe(false)
    expect(wantsAttachment('0')).toBe(false)
    expect(wantsAttachment('yes')).toBe(false)
  })
})
