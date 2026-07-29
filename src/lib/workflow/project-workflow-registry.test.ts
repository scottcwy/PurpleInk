import { describe, expect, it } from 'vitest'
import {
  ACTIVE_WORKFLOW_VERSION,
  serializeWorkflowVersion,
} from './version'
import {
  PROJECT_WORKFLOW_KINDS,
  PROJECT_WORKFLOW_REGISTRY,
  activeWorkflowVersionFor,
  isActiveProjectWorkflow,
} from './project-workflow-registry'

describe('project workflow registry', () => {
  it('locks the three stable source kinds', () => {
    expect(PROJECT_WORKFLOW_KINDS).toEqual(['script', 'audio', 'website'])
  })

  it('preserves the existing script workflow version exactly', () => {
    expect(activeWorkflowVersionFor('script')).toBe(
      serializeWorkflowVersion(ACTIVE_WORKFLOW_VERSION)
    )
  })

  it('gives audio and website independent stable versions', () => {
    expect(PROJECT_WORKFLOW_REGISTRY.audio.activeWorkflowVersion).toBe(
      'purpleink-audio-to-video-v1'
    )
    expect(PROJECT_WORKFLOW_REGISTRY.website.activeWorkflowVersion).toBe(
      'purpleink-website-intro-video-v1'
    )
    expect(PROJECT_WORKFLOW_REGISTRY.audio.activeWorkflowVersion).not.toBe(
      PROJECT_WORKFLOW_REGISTRY.website.activeWorkflowVersion
    )
  })

  it('requires both kind and version to match', () => {
    expect(
      isActiveProjectWorkflow(
        'audio',
        activeWorkflowVersionFor('audio')
      )
    ).toBe(true)
    expect(
      isActiveProjectWorkflow(
        'website',
        activeWorkflowVersionFor('audio')
      )
    ).toBe(false)
    expect(isActiveProjectWorkflow('script', 'legacy-script-v1')).toBe(false)
  })
})
