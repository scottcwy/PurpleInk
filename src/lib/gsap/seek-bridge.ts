/**
 * GSAP ↔ seek 确定性桥。
 * 约定：shot 使用 gsap.timeline({ paused: true })，渲染器每帧调用 seek(frameToTime(frame, fps))。
 */

/** 帧号 → 时间线秒数。 */
export function frameToTime(frame: number, fps: number): number {
  return frame / fps
}

/** 最小可 seek 时间线接口（避免在共享层耦合 gsap 运行时类型）。 */
export interface SeekableTimeline {
  seek(time: number): unknown
  duration(): number
}

/** 把时间线定位到指定帧（确定性：同帧同状态）。 */
export function seekToFrame(timeline: SeekableTimeline, frame: number, fps: number): void {
  timeline.seek(frameToTime(frame, fps))
}

/** shot HTML 运行时约定片段（供代码视频生成器参考）。 */
export const PAUSED_TIMELINE_SNIPPET = [
  'const tl = gsap.timeline({ paused: true });',
  '// 渲染器每帧：tl.seek(frame / fps)',
].join('\n')
