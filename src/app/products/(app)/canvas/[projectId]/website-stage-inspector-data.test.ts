import { describe, expect, it } from 'vitest'
import {
  parseWebsiteExecution,
  WEBSITE_INSPECTOR_TABS,
} from './website-stage-inspector-data'

describe('website stage inspector projection', () => {
  it('keeps only the declared websiteExecution allowlist', () => {
    const projection = parseWebsiteExecution({
      websiteExecution: {
        schemaVersion: 1,
        phase: 'render',
        state: 'running',
        enginePhase: 'rendering',
        durationSec: 24,
        durationSource: 'request',
        elapsedSec: 9.2,
        updatedAt: '2026-07-30T01:00:00.000Z',
        verification: {
          checkPassed: false,
          goldenVerified: true,
          goldenCheckCount: 3,
          outcome: 'degraded',
          rawProviderError: 'secret provider body',
        },
        headers: { authorization: 'Bearer secret' },
        cookies: 'session=secret',
        dom: '<html>secret</html>',
        credential: 'secret',
      },
    })

    expect(projection).toMatchObject({
      phase: 'render',
      state: 'running',
      enginePhase: 'rendering',
      verification: {
        checkPassed: false,
        goldenVerified: true,
        goldenCheckCount: 3,
        outcome: 'degraded',
      },
    })
    const serialized = JSON.stringify(projection)
    for (const forbidden of [
      'headers',
      'cookies',
      'dom',
      'credential',
      'rawProviderError',
      'secret',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('uses a fixed four-tab order and rejects malformed projections', () => {
    expect(WEBSITE_INSPECTOR_TABS.map((tab) => tab.label)).toEqual([
      'Data',
      'Source',
      'Gates',
      'Execution',
    ])
    expect(parseWebsiteExecution({})).toBeUndefined()
    expect(
      parseWebsiteExecution({
        websiteExecution: {
          phase: 'unknown',
          state: 'pretend-success',
          failure: { code: 'raw stack and key' },
        },
      }),
    ).toBeUndefined()
  })

  it('projects only safe failure and final Artifact metadata', () => {
    expect(
      parseWebsiteExecution({
        websiteExecution: {
          phase: 'export',
          state: 'failed',
          failure: { code: 'WEBSITE_VIDEO_INVALID', message: 'raw ffmpeg output' },
          artifact: {
            artifactId: 'artifact-1',
            contentHash: 'a'.repeat(64),
            sizeBytes: 2048,
            storageKey: 'private/path/video.mp4',
          },
        },
      }),
    ).toEqual({
      phase: 'export',
      state: 'failed',
      failureCode: 'WEBSITE_VIDEO_INVALID',
      artifact: {
        artifactId: 'artifact-1',
        contentHash: 'a'.repeat(64),
        sizeBytes: 2048,
      },
    })
  })
})
