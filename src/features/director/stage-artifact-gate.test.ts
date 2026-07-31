import { describe, expect, it, vi } from 'vitest'
import { generateValidatedArtifact } from './stage-artifact-gate'
import type { DirectorRunResult } from './pi-session'
import type { DirectorStageContext } from './runtime-repository'
import type {
  ArtifactCommitResult,
  WriteArtifactInput,
} from './tools/write-artifact'

vi.mock('server-only', () => ({}))

const VALID_SOURCE = `<!doctype html><html><head>
<meta name="viewport" content="width=1920, height=1080">
<style>
html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
* { box-sizing: border-box; }
[data-composition-id] { width: 1920px; height: 1080px; overflow: hidden; }
</style></head><body>
<main data-composition-id="shot" data-width="1920" data-height="1080"></main>
<script>
window.__CVC_RENDER__ = { version: 1, seek() {} };
</script></body></html>`

const context: DirectorStageContext = {
  projectId: 'project-1',
  nodeId: 'node-1',
  nodeType: 'shot-codegen',
  stage: 'FABRICATE',
  status: 'pending',
  projectTitle: '项目',
  projectScript: '脚本',
  directorInput: {},
}

function recovered(content: string): DirectorRunResult {
  return {
    artifactContent: content,
    displayText: content,
    provenance: {
      kind: 'assistant-text-recovery',
      toolName: 'check_determinism',
    },
  }
}

function artifact(): ArtifactCommitResult {
  return {
    id: 'artifact-1',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    projectId: 'project-1',
    aggregateType: 'node',
    aggregateId: 'node-1',
    kind: 'director-fabricate',
    schemaVersion: 'cvc.director-artifact/v1',
    storageKey: 'director/shot.html',
    sizeBytes: 32,
    contentHash: 'a'.repeat(64),
    attemptId: 'attempt-1',
    storageKeyAlreadyExisted: false,
  }
}

describe('generateValidatedArtifact FABRICATE recovery', () => {
  it('rejects static recovery violations before starting Chromium', async () => {
    const staticViolation =
      '<html><script>requestAnimationFrame(render)</script></html>'
    const session = {
      id: 'session-1',
      storageKey: 'session.jsonl',
      run: vi.fn(async () => recovered(staticViolation)),
      close: vi.fn(async () => undefined),
    }
    const probeRuntime = vi.fn(async () => [])
    const writeArtifact = vi.fn(async (_input: WriteArtifactInput) => artifact())

    await expect(generateValidatedArtifact({
      stage: 'FABRICATE',
      context,
      session,
      initialPrompt: '生成镜头',
      prepareResult: async (_context, content) => ({ content }),
      writeArtifact,
      probeRuntime,
    })).rejects.toThrow('自动重试 2 次后仍违规')

    expect(session.run).toHaveBeenCalledTimes(3)
    expect(probeRuntime).not.toHaveBeenCalled()
    expect(writeArtifact).not.toHaveBeenCalled()
  })

  it('runs the browser gate before committing runtime-safe recovery HTML', async () => {
    const controller = new AbortController()
    const runtimeViolation = VALID_SOURCE.replace(
      'data-composition-id="shot"',
      'data-composition-id="bad"',
    )
    const session = {
      id: 'session-1',
      storageKey: 'session.jsonl',
      run: vi.fn()
        .mockResolvedValueOnce(recovered(runtimeViolation))
        .mockResolvedValueOnce(recovered(VALID_SOURCE)),
      close: vi.fn(async () => undefined),
    }
    const probeRuntime = vi.fn()
      .mockResolvedValueOnce([
        {
          ruleId: 'runtime-page-script' as const,
          message: '页面脚本执行失败',
        },
      ])
      .mockResolvedValueOnce([])
    const writeArtifact = vi.fn(async (_input: WriteArtifactInput) => artifact())

    await expect(generateValidatedArtifact({
      stage: 'FABRICATE',
      context,
      session,
      initialPrompt: '生成镜头',
      prepareResult: async (_context, content) => ({ content }),
      writeArtifact,
      probeRuntime,
      signal: controller.signal,
    })).resolves.toMatchObject({
      prepared: { content: VALID_SOURCE },
    })

    expect(session.run).toHaveBeenCalledTimes(2)
    expect(session.run).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(probeRuntime).toHaveBeenNthCalledWith(
      1,
      runtimeViolation,
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(writeArtifact).toHaveBeenCalledOnce()
    expect(writeArtifact.mock.calls[0]?.[0]).toMatchObject({
      content: VALID_SOURCE,
    })
  })

  it('does not repeat the browser probe after a successful tool result', async () => {
    const session = {
      id: 'session-1',
      storageKey: 'session.jsonl',
      run: vi.fn(async (): Promise<DirectorRunResult> => ({
        artifactContent: '<html>checked</html>',
        displayText: '',
        provenance: {
          kind: 'tool-argument',
          toolName: 'check_determinism',
          toolCallId: 'call-1',
        },
      })),
      close: vi.fn(async () => undefined),
    }
    const probeRuntime = vi.fn(async () => [])
    const writeArtifact = vi.fn(async (_input: WriteArtifactInput) => artifact())

    await generateValidatedArtifact({
      stage: 'FABRICATE',
      context,
      session,
      initialPrompt: '生成镜头',
      prepareResult: async (_context, content) => ({ content }),
      writeArtifact,
      probeRuntime,
    })

    expect(probeRuntime).not.toHaveBeenCalled()
    expect(writeArtifact).toHaveBeenCalledOnce()
  })
})
