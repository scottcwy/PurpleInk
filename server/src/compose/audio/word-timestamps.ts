// 词级时间戳工具：均匀分配 / 同步语音时长到帧时长。
import type { WordTimestamp } from "./types.js"

/**
 * 从文本生成词级时间戳。
 * 如果提供商已返回时间戳（existing），直接透传；
 * 否则按字符数均匀分配到 [0, duration_s] 区间。
 */
export function distributeWordTimestamps(
  text: string,
  duration_s: number,
  existing?: WordTimestamp[],
): WordTimestamp[] {
  if (existing && existing.length > 0) return existing

  // 按空白分词（支持中英文混合）
  const tokens = text.split(/(?<=[\u4e00-\u9fff])|(?=\s)/).filter((t) => t.trim().length > 0)
  if (tokens.length === 0) return []

  // 按每个 token 的字符数加权分配时长
  const totalChars = tokens.reduce((sum, t) => sum + t.length, 0)
  const charPerSec = totalChars / Math.max(duration_s, 0.01)

  let cursor = 0
  return tokens.map((token, i) => {
    const start = cursor
    const tokenDuration = token.length / charPerSec
    cursor = start + tokenDuration
    return {
      id: i + 1,
      text: token.trim(),
      start: Math.round(start * 1000) / 1000,
      end: Math.round(Math.min(cursor, duration_s) * 1000) / 1000,
    }
  })
}

/**
 * 判断语音时长是否超出帧时长，返回调整后的时长与是否需要扩展帧。
 *
 * - 语音时长 <= 帧时长：正常，adjustedDuration = voiceDuration
 * - 语音时长 > 帧时长：标记 needsFrameExtension，adjustedDuration 截断到帧时长
 */
export function syncVoiceToFrame(
  voiceDuration: number,
  frameDuration: number,
): { adjustedDuration: number; needsFrameExtension: boolean } {
  if (voiceDuration <= frameDuration) {
    return { adjustedDuration: voiceDuration, needsFrameExtension: false }
  }
  // 语音超出帧时长：截断语音到帧时长（后续帧可接续或淡出）
  return { adjustedDuration: frameDuration, needsFrameExtension: true }
}
