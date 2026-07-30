import { describe, expect, it } from 'vitest'
import type { WebsiteEngineJob, WebsiteEnginePhase } from './engine-client'
import {
  safeWebsiteStageProgress,
  websiteNodeTransitionPlan,
  workflowPhaseForEnginePhase,
} from './website-stage-contract'

describe('website workflow stage contract', () => {
  it.each([
    ['queued', 'capture'],
    ['capturing', 'capture'],
    ['scripting', 'script'],
    ['synthesizing', 'narration'],
    ['timing', 'narration'],
    ['composing', 'compose'],
    ['rendering', 'render'],
    ['verifying', 'render'],
    ['muxing', 'export'],
    ['done', 'export'],
  ] satisfies Array<[WebsiteEnginePhase, string]>)(
    'maps engine phase %s to workflow phase %s',
    (enginePhase, workflowPhase) => {
      expect(workflowPhaseForEnginePhase(enginePhase)).toBe(workflowPhase)
    },
  )

  it('projects only allowlisted progress metadata', () => {
    const unsafeJob = {
      ...job(),
      rawProviderError: 'credential=secret',
      cookies: 'session=secret',
      dom: '<html>private</html>',
    }
    const projection = safeWebsiteStageProgress(unsafeJob)
    const serialized = JSON.stringify(projection)

    expect(projection).toMatchObject({
      phase: 'capture',
      enginePhase: 'capturing',
      verification: null,
    })
    expect(serialized).not.toContain('credential')
    expect(serialized).not.toContain('cookies')
    expect(serialized).not.toContain('<html>')
    expect(serialized).not.toContain('private=campaign')
  })

  it('keeps failed worker checks as an explicit degraded outcome', () => {
    const projection = safeWebsiteStageProgress(job({
      checkPassed: false,
      goldenVerified: true,
      goldenCheckCount: 3,
    }))

    expect(projection.verification).toEqual({
      checkPassed: false,
      goldenVerified: true,
      goldenCheckCount: 3,
      outcome: 'degraded',
    })
  })

  it('builds legal recovery transitions without downgrading succeeded stages', () => {
    expect(websiteNodeTransitionPlan('idle', 'success')).toEqual([
      'pending',
      'running',
      'success',
    ])
    expect(websiteNodeTransitionPlan('failed', 'running')).toEqual([
      'pending',
      'running',
    ])
    expect(websiteNodeTransitionPlan('queued', 'cancelled')).toEqual(['cancelled'])
    expect(websiteNodeTransitionPlan('idle', 'cancelled')).toEqual([
      'pending',
      'cancelled',
    ])
    expect(websiteNodeTransitionPlan('succeeded', 'failed')).toEqual([])
  })

  it('restarts a succeeded stage through stale and leaves later stages resettable', () => {
    expect(websiteNodeTransitionPlan('succeeded', 'running')).toEqual([
      'stale',
      'pending',
      'running',
    ])
    expect(websiteNodeTransitionPlan('succeeded', 'reset')).toEqual(['stale'])
    expect(websiteNodeTransitionPlan('failed', 'reset')).toEqual([])
  })
})

function job(overrides: Partial<WebsiteEngineJob> = {}): WebsiteEngineJob {
  return {
    id: 'job-1',
    requestId: 'request-1',
    origin: 'https://example.com/product?private=campaign',
    status: 'running',
    phase: 'capturing',
    durationSec: 30,
    durationSource: 'request',
    elapsedSec: 1,
    checkPassed: null,
    goldenVerified: null,
    goldenCheckCount: 0,
    hasVideo: false,
    videoUrl: null,
    failure: null,
    ...overrides,
  }
}
