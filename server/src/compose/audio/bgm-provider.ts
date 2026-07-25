// BGM 提供商：从本地音乐库匹配或返回 null。
import { readdir } from "node:fs/promises"
import { extname } from "node:path"
import type { BgmConfig, BgmTrack } from "./types.js"
import { logger } from "../../lib/logger.js"

// ── 公共接口 ────────────────────────────────────────────────────────────────

export interface BgmProvider {
  name: string
  retrieve(query: string, duration_s: number): Promise<BgmTrack | null>
}

// ── LocalBgmProvider ─────────────────────────────────────────────────────────

/**
 * 扫描 libraryPath 目录下的 mp3 文件，按文件名关键词匹配 query。
 * 匹配策略：将 query 拆分为词，统计每个文件名命中词数，取最高分。
 * 无匹配时返回 null。
 */
export class LocalBgmProvider implements BgmProvider {
  name = "local"
  private libraryPath: string

  constructor(libraryPath: string) {
    this.libraryPath = libraryPath
  }

  async retrieve(query: string, duration_s: number): Promise<BgmTrack | null> {
    let files: string[]
    try {
      const entries = await readdir(this.libraryPath)
      files = entries.filter((f) => extname(f).toLowerCase() === ".mp3")
    } catch {
      logger.warn("bgm:local_library_unreadable", { path: this.libraryPath })
      return null
    }

    if (files.length === 0) {
      logger.warn("bgm:local_library_empty", { path: this.libraryPath })
      return null
    }

    // 将 query 拆分为小写词
    const queryWords = query
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter((w) => w.length > 0)

    if (queryWords.length === 0) return null

    // 对每个文件打分
    let bestFile = ""
    let bestScore = 0
    for (const file of files) {
      const nameLower = file.toLowerCase().replace(extname(file), "")
      let score = 0
      for (const w of queryWords) {
        if (nameLower.includes(w)) score++
      }
      if (score > bestScore) {
        bestScore = score
        bestFile = file
      }
    }

    if (bestScore === 0) {
      logger.info("bgm:local_no_match", { query, files: files.length })
      return null
    }

    logger.info("bgm:local_matched", { query, file: bestFile, score: bestScore })
    return {
      path: `assets/bgm/${bestFile}`,
      volume: 0.3, // 默认低音量，不盖过旁白
      query,
      duration_s,
    }
  }
}

// ── NoneBgmProvider ──────────────────────────────────────────────────────────

/** 不生成 BGM，始终返回 null。 */
export class NoneBgmProvider implements BgmProvider {
  name = "none"

  async retrieve(_query: string, _duration_s: number): Promise<BgmTrack | null> {
    return null
  }
}

// ── 工厂 ─────────────────────────────────────────────────────────────────────

export function createBgmProvider(config: BgmConfig): BgmProvider {
  switch (config.provider) {
    case "local":
      if (!config.libraryPath) {
        throw new Error("Local BGM: libraryPath not configured")
      }
      return new LocalBgmProvider(config.libraryPath)
    case "none":
    case "heygen": // heygen 未实现，降级为 none
      return new NoneBgmProvider()
    default:
      throw new Error(`Unknown BGM provider: ${config.provider}`)
  }
}
