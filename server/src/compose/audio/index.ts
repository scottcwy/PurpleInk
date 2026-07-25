// 音频系统公共 API。
export { generateAudio, writeAudioMeta, readAudioMeta } from "./audio-pipeline.js"
export { createTtsProvider } from "./tts-provider.js"
export { createBgmProvider } from "./bgm-provider.js"
export { distributeWordTimestamps, syncVoiceToFrame } from "./word-timestamps.js"
export type {
  AudioMeta,
  AudioConfig,
  TtsConfig,
  BgmConfig,
  VoiceTrack,
  BgmTrack,
  SfxTrack,
  WordTimestamp,
} from "./types.js"
