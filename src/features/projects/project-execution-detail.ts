import type {
  ProjectExecutionDetail,
  ProjectExecutionFacts,
  ProjectWorkItemSnapshot,
  ProjectWorkItemState,
  ShotWorkflowSnapshot,
  WebsiteStageSnapshot,
} from './project-execution-contract'

const SHOT_ROLE_ORDER = [
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
] as const

export function executionDetail(
  facts: ProjectExecutionFacts,
  websiteStages: WebsiteStageSnapshot[],
): ProjectExecutionDetail {
  if (facts.project.workflowKind === 'website') {
    return { kind: 'website', stages: websiteStages }
  }
  const items = facts.nodes.map(workItem)
  const shared = {
    director: items.filter(({ logicalKey }) =>
      logicalKey === 'global:script-import' || logicalKey === 'global:shot-split'),
    fanOut: shotFanOut(items),
    merge: findItem(items, 'global:score'),
    export: findItem(items, 'global:export'),
  }
  if (facts.project.workflowKind === 'audio') {
    const asrNode = facts.nodes.find(({ logicalKey }) =>
      logicalKey === 'source:audio-transcribe')
    const transcription = record(record(asrNode?.data).payload).audioTranscription
    const projection = record(transcription)
    return {
      kind: 'audio',
      asr: asrNode ? workItem(asrNode) : null,
      sourceAudioBound: projection.status === 'ready'
        && typeof projection.audioArtifactId === 'string',
      ...shared,
    }
  }
  return { kind: 'script', ...shared }
}

export function currentProjectWork(
  facts: ProjectExecutionFacts,
  websiteStages: WebsiteStageSnapshot[],
): ProjectWorkItemSnapshot | null {
  const candidates = facts.project.workflowKind === 'website'
    ? websiteStages.map((stage) => ({
        nodeId: stage.nodeId,
        logicalKey: `website:${stage.phase}`,
        state: stage.state,
        updatedAt: stage.updatedAt,
      }))
    : facts.nodes.map(workItem)
  return candidates.find(({ state }) =>
    ['running', 'queued', 'blocked', 'failed', 'stale'].includes(state)) ?? null
}

function shotFanOut(items: ProjectWorkItemSnapshot[]) {
  const grouped = new Map<string, ProjectWorkItemSnapshot[]>()
  for (const item of items) {
    const match = /^shot:([^:]+):(shot-[a-z-]+)$/u.exec(item.logicalKey)
    if (!match || !SHOT_ROLE_ORDER.includes(match[2] as typeof SHOT_ROLE_ORDER[number])) {
      continue
    }
    const steps = grouped.get(match[1]!) ?? []
    steps.push(item)
    grouped.set(match[1]!, steps)
  }
  const shots: ShotWorkflowSnapshot[] = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([shotId, steps]) => {
      const ordered = steps.sort((left, right) =>
        SHOT_ROLE_ORDER.indexOf(role(left.logicalKey))
        - SHOT_ROLE_ORDER.indexOf(role(right.logicalKey)))
      return { shotId, state: aggregateState(ordered), steps: ordered }
    })
  return {
    shotCount: shots.length,
    completedShotCount: shots.filter(({ state }) => state === 'succeeded').length,
    shots,
  }
}

function aggregateState(items: ProjectWorkItemSnapshot[]): ProjectWorkItemState {
  if (items.some(({ state }) => state === 'failed' || state === 'blocked')) return 'failed'
  if (items.some(({ state }) => state === 'running')) return 'running'
  if (items.some(({ state }) => state === 'queued')) return 'queued'
  if (items.some(({ state }) => state === 'stale')) return 'stale'
  if (items.length > 0 && items.every(({ state }) =>
    state === 'succeeded' || state === 'skipped')) return 'succeeded'
  if (items.length > 0 && items.every(({ state }) => state === 'cancelled')) return 'cancelled'
  return 'idle'
}

function findItem(
  items: ProjectWorkItemSnapshot[],
  logicalKey: string,
): ProjectWorkItemSnapshot | null {
  return items.find((item) => item.logicalKey === logicalKey) ?? null
}

function workItem(
  node: ProjectExecutionFacts['nodes'][number],
): ProjectWorkItemSnapshot {
  return {
    nodeId: node.id,
    logicalKey: node.logicalKey,
    state: workItemState(node.status),
    updatedAt: node.updatedAt,
  }
}

function workItemState(status: string): ProjectWorkItemState {
  if (status === 'success' || status === 'succeeded') return 'succeeded'
  if (status === 'pending') return 'idle'
  if (
    status === 'idle'
    || status === 'queued'
    || status === 'running'
    || status === 'skipped'
    || status === 'blocked'
    || status === 'failed'
    || status === 'cancelled'
    || status === 'stale'
  ) return status
  return 'idle'
}

function role(logicalKey: string): typeof SHOT_ROLE_ORDER[number] {
  return logicalKey.slice(logicalKey.lastIndexOf(':') + 1) as typeof SHOT_ROLE_ORDER[number]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
