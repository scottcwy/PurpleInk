import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  computeLayout,
  NODE_HEIGHT,
  NODE_WIDTH,
  type LayoutEdge,
  type LayoutNode,
} from './layout'

describe('computeLayout', () => {
  it('lays out 50 shot lanes without duplicate coordinates', () => {
    const { nodes, edges } = largeGraph(50)
    const startedAt = performance.now()
    const positions = computeLayout(nodes, edges)
    const elapsedMs = performance.now() - startedAt
    console.info(`computeLayout 50 lanes / ${nodes.length} nodes: ${elapsedMs.toFixed(2)}ms`)

    expect(positions.size).toBe(nodes.length)
    expect(new Set([...positions.values()].map(({ x, y }) => `${x}:${y}`)).size).toBe(
      nodes.length
    )
  })

  it('keeps global nodes on one trunk and each lane on an ordered row', () => {
    const { nodes, edges } = largeGraph(3)
    const positions = computeLayout(nodes, edges)

    const globalY = ['script-import', 'shot-split', 'score', 'export'].map(
      (id) => positions.get(id)?.y
    )
    expect(new Set(globalY).size).toBe(1)

    for (let laneIndex = 0; laneIndex < 3; laneIndex += 1) {
      const lanePositions = laneRoles.map((role) => positions.get(`shot-${laneIndex}-${role}`)!)
      expect(new Set(lanePositions.map(({ y }) => y)).size).toBe(1)
      expect(lanePositions.map(({ x }) => x)).toEqual(
        [...lanePositions.map(({ x }) => x)].sort((left, right) => left - right)
      )
    }
  })

  it('never overlaps two node bounding boxes across lanes and the global trunk', () => {
    const { nodes, edges } = largeGraph(8)
    const positions = computeLayout(nodes, edges)
    const boxes = [...positions.values()].map((position) => ({
      left: position.x,
      right: position.x + NODE_WIDTH,
      top: position.y,
      bottom: position.y + NODE_HEIGHT,
    }))

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false)
      }
    }
  })

  it('does not move existing lanes when a new lane is appended with a later shot id', () => {
    const before = laneGraph(['S001', 'S002', 'S003'])
    const beforePositions = computeLayout(before.nodes, before.edges)

    const after = laneGraph(['S001', 'S002', 'S003', 'S004'])
    const afterPositions = computeLayout(after.nodes, after.edges)

    for (const node of before.nodes) {
      expect(afterPositions.get(node.id)).toEqual(beforePositions.get(node.id))
    }
  })
})

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

/** 与生产 shotId 格式（`S` + 零填充三位序号）一致的泳道，保证字典序等于生成顺序。 */
function laneGraph(shotIds: readonly string[]): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes: LayoutNode[] = [
    { id: 'script-import', type: 'script-import' },
    { id: 'shot-split', type: 'shot-split' },
    { id: 'score', type: 'score' },
    { id: 'export', type: 'export' },
  ]
  const edges: LayoutEdge[] = [
    { source: 'script-import', target: 'shot-split' },
    { source: 'score', target: 'export' },
  ]

  for (const shotId of shotIds) {
    const laneNodes = laneRoles.map((type) => ({
      id: `${shotId}-${type}`,
      type,
      laneKey: shotId,
    }))
    nodes.push(...laneNodes)
    edges.push({ source: 'shot-split', target: laneNodes[0]!.id })
    for (let index = 0; index < laneNodes.length - 1; index += 1) {
      edges.push({ source: laneNodes[index]!.id, target: laneNodes[index + 1]!.id })
    }
    edges.push({ source: laneNodes.at(-1)!.id, target: 'score' })
  }

  return { nodes, edges }
}

const laneRoles = [
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
] as const

function largeGraph(laneCount: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const nodes: LayoutNode[] = [
    { id: 'script-import', type: 'script-import' },
    { id: 'shot-split', type: 'shot-split' },
    { id: 'score', type: 'score' },
    { id: 'export', type: 'export' },
  ]
  const edges: LayoutEdge[] = [
    { source: 'script-import', target: 'shot-split' },
    { source: 'score', target: 'export' },
  ]

  for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
    const laneKey = `shot-${laneIndex}`
    const laneNodes = laneRoles.map((type) => ({
      id: `${laneKey}-${type}`,
      type,
      laneKey,
    }))
    nodes.push(...laneNodes)
    edges.push({ source: 'shot-split', target: laneNodes[0]!.id })
    for (let index = 0; index < laneNodes.length - 1; index += 1) {
      edges.push({ source: laneNodes[index]!.id, target: laneNodes[index + 1]!.id })
    }
    edges.push({ source: laneNodes.at(-1)!.id, target: 'score' })
  }

  return { nodes, edges }
}
