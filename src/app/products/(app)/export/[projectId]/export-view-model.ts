export interface TimelineClip {
  start: number
  width: number
  label: string
}

const CLIP_WIDTH = 92
const CLIP_GAP = 8
const TRACK_INSET = 4

/** 将真实分镜通道投影为 Pencil S5 的时间线片段。 */
export function buildShotClips(laneKeys: readonly string[]): TimelineClip[] {
  return [...laneKeys]
    .sort((left, right) => left.localeCompare(right))
    .map((laneKey, index) => ({
      start: TRACK_INSET + index * (CLIP_WIDTH + CLIP_GAP),
      width: CLIP_WIDTH,
      label: laneKey,
    }))
}

export function fullTrackClip(
  label: string,
  shotCount: number
): TimelineClip[] {
  if (shotCount === 0) return []
  return [{
    start: TRACK_INSET,
    width: shotCount * CLIP_WIDTH + Math.max(0, shotCount - 1) * CLIP_GAP,
    label,
  }]
}
