// 音频管线：从 Storyboard 生成 audio_meta.json。
// 流程：遍历帧 → TTS 合成旁白 → BGM 匹配 → 组装 AudioMeta → 写出 JSON。
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { AudioMeta, AudioConfig, VoiceTrack } from "./types.js"
import type { Storyboard } from "../storyboard/types.js"
import { createTtsProvider, writeAudioFile } from "./tts-provider.js"
import { createBgmProvider } from "./bgm-provider.js"
import { distributeWordTimestamps } from "./word-timestamps.js"
import { logger } from "../../lib/logger.js"

/**
 * 从 Storyboard 生成完整的 audio_meta.json。
 *
 * 流程：
 * 1. 遍历 storyboard 的每帧，提取 voiceover 文本
 * 2. 调用 TTS 生成每帧的语音（串行，避免 API 限流）
 * 3. 调用 BGM 获取背景音乐
 * 4. 组装 AudioMeta 并写出 audio_meta.json
 */
export async function generateAudio(
  storyboard: Storyboard,
  config: AudioConfig,
  onProgress?: (msg: string) => void,
): Promise<AudioMeta> {
  const tts = createTtsProvider(config.tts)
  const bgm = createBgmProvider(config.bgm)

  // 确保输出目录存在
  const voiceDir = join(config.outputDir, "assets", "voice")
  await mkdir(voiceDir, { recursive: true })

  const voices: VoiceTrack[] = []

  // 串行遍历每帧生成 TTS（避免并发 API 限流）
  for (let i = 0; i < storyboard.shots.length; i++) {
    const shot = storyboard.shots[i]!
    const voiceoverText = shot.voiceover || shot.narration || ""

    if (!voiceoverText.trim()) {
      onProgress?.(`帧 ${i + 1}/${storyboard.shots.length}：无旁白，跳过`)
      continue
    }

    onProgress?.(`帧 ${i + 1}/${storyboard.shots.length}：TTS 合成中…`)

    try {
      const ttsOpts: { voice?: string; language?: string } = {}
      if (config.tts.voice !== undefined) ttsOpts.voice = config.tts.voice
      if (config.tts.language !== undefined) ttsOpts.language = config.tts.language
      const result = await tts.synthesize(voiceoverText, ttsOpts)

      // 写入音频文件，文件名按帧序号补零
      const frameNum = String(i + 1).padStart(2, "0")
      const ext = result.format // "wav" | "mp3"
      const { relPath, duration_s } = await writeAudioFile(
        result,
        config.outputDir,
        "assets/voice",
        `${frameNum}.${ext}`,
      )

      // 分配词级时间戳
      const words = distributeWordTimestamps(voiceoverText, duration_s, result.words)

      voices.push({
        frame: i,
        path: relPath,
        duration_s,
        words,
      })

      logger.info("audio:frame_done", { frame: i + 1, duration_s, text: voiceoverText.slice(0, 30) })
    } catch (err) {
      logger.error("audio:frame_failed", { frame: i + 1, error: String(err) })
      // 单帧失败不中断整条管线，跳过该帧继续
    }
  }

  // BGM：用 storyboard 的 tagline 作为检索关键词
  onProgress?.("BGM 匹配中…")
  const totalDuration = storyboard.meta.totalDuration || 30
  const bgmQuery = storyboard.meta.tagline || storyboard.meta.brand || "ambient"
  const bgmTrack = await bgm.retrieve(bgmQuery, totalDuration)

  const meta: AudioMeta = {
    bgm: bgmTrack,
    voices,
    sfx: [],
  }

  onProgress?.(`音频生成完成：${voices.length} 帧旁白，BGM ${bgmTrack ? "已匹配" : "无"}`)
  logger.info("audio:meta_built", { voices: voices.length, bgm: !!bgmTrack })
  return meta
}

/** 将 AudioMeta 写入 JSON 文件 */
export async function writeAudioMeta(meta: AudioMeta, outputPath: string): Promise<void> {
  await mkdir(join(outputPath, ".."), { recursive: true }).catch(() => {})
  await writeFile(outputPath, JSON.stringify(meta, null, 2), "utf8")
  logger.info("audio:meta_written", { path: outputPath })
}

/** 从 audio_meta.json 读取 */
export async function readAudioMeta(path: string): Promise<AudioMeta> {
  const raw = await readFile(path, "utf8")
  return JSON.parse(raw) as AudioMeta
}
