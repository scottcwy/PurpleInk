// 音频系统类型定义：TTS 旁白、BGM 背景音乐、SFX 音效、词级时间戳。
// 对齐 HyperFrames audio_meta.json 格式。

/** 词级时间戳 */
export interface WordTimestamp {
  id: number
  text: string
  start: number // 秒
  end: number // 秒
}

/** 单帧的语音轨道 */
export interface VoiceTrack {
  frame: number // 对应 storyboard 帧序号
  path: string // 音频文件相对路径 e.g. "assets/voice/03.wav"
  duration_s: number // 语音时长（秒）
  words: WordTimestamp[] // 词级时间戳
}

/** BGM 轨道 */
export interface BgmTrack {
  path: string // 音频文件相对路径 e.g. "assets/bgm/x.mp3"
  volume: number // 音量 0-1
  query: string // 检索关键词
  duration_s: number // BGM 时长
}

/** SFX 音效轨道 */
export interface SfxTrack {
  frame: number
  file: string
  offset_s: number
  duration_s: number
  volume: number
}

/** 完整的音频元数据（对齐 HyperFrames audio_meta.json 格式） */
export interface AudioMeta {
  bgm: BgmTrack | null
  voices: VoiceTrack[]
  sfx: SfxTrack[]
}

/** TTS 提供商配置 */
export interface TtsConfig {
  provider: "azure" | "elevenlabs" | "mock"
  apiKey?: string
  region?: string
  voice?: string // 语音 ID
  language?: string // e.g. "zh-CN"
}

/** BGM 提供商配置 */
export interface BgmConfig {
  provider: "local" | "heygen" | "none"
  apiKey?: string
  libraryPath?: string // 本地音乐库路径
}

/** 音频管线配置 */
export interface AudioConfig {
  tts: TtsConfig
  bgm: BgmConfig
  outputDir: string // 音频文件输出目录
}
