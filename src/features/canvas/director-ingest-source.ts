/**
 * 会继续进入既有 Director / Render 链路的入口节点合同。
 *
 * website-stage 由独立网站执行器闭环，不属于该集合。
 */
export const DIRECTOR_INGEST_SOURCE_NODE_TYPES = [
  'script-import',
  'audio-transcribe',
] as const

export type DirectorIngestSourceNodeType =
  (typeof DIRECTOR_INGEST_SOURCE_NODE_TYPES)[number]

export function isDirectorIngestSourceNodeType(
  value: string,
): value is DirectorIngestSourceNodeType {
  return DIRECTOR_INGEST_SOURCE_NODE_TYPES.some((candidate) => candidate === value)
}
