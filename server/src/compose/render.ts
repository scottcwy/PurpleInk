// 封装 hyperframes check + render 两步 CLI。
// 关键：ffmpeg 由 winget 用户作用域安装、不在默认 PATH，这里自动定位并前置到子进程 PATH。
import { spawn } from "node:child_process"
import { readdir, stat } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join, delimiter } from "node:path"
import { logger } from "../lib/logger"

const HF_VERSION = "0.7.68"

export interface RenderOptions {
  /** hyperframes render --quality（默认 high） */
  quality?: string
  /** 跳过 check（默认 false） */
  skipCheck?: boolean
  /** 手动指定 ffmpeg 所在 bin 目录（覆盖自动探测） */
  ffmpegDir?: string
  /** 单步超时 ms（默认 20 分钟，覆盖 60–120s 正片） */
  timeoutMs?: number
}

export interface RenderResult {
  checkPassed: boolean
  checkOutput: string
  videoPath: string | null
  renderOutput: string
}

/** 探测 ffmpeg 所在 bin 目录：显式 > 环境变量 > 已在 PATH > winget 包目录 */
async function resolveFfmpegDir(override?: string): Promise<string | null> {
  if (override && existsSync(override)) return override
  const envDir = process.env.PURPLEINK_FFMPEG_DIR || process.env.FFMPEG_DIR
  if (envDir && existsSync(join(envDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))) return envDir

  // 已在 PATH 里则无需前置
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (dir && existsSync(join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))) return null
  }

  // winget 包目录：<LOCALAPPDATA>\Microsoft\WinGet\Packages\Gyan.FFmpeg*\ffmpeg-*\bin
  const base = join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages")
  try {
    for (const pkg of await readdir(base)) {
      if (!/^Gyan\.FFmpeg/i.test(pkg)) continue
      const pkgDir = join(base, pkg)
      for (const sub of await readdir(pkgDir)) {
        if (!/^ffmpeg-/i.test(sub)) continue
        const bin = join(pkgDir, sub, "bin")
        if (existsSync(join(bin, "ffmpeg.exe"))) return bin
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 跑一条命令，收集 stdout+stderr，带超时 */
function runCommand(
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, env, shell: true })
    let output = ""
    const onData = (d: Buffer) => {
      output += d.toString()
    }
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      output += "\n[purpleink] timed out\n"
    }, timeoutMs)
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, output })
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      resolve({ code: -1, output: output + "\n[spawn error] " + String(err) })
    })
  })
}

/** 找 renders/ 下最新的 mp4 */
async function findNewestMp4(projectDir: string): Promise<string | null> {
  const rendersDir = join(projectDir, "renders")
  let files: string[] = []
  try {
    files = await readdir(rendersDir)
  } catch {
    return null
  }
  const mp4s = files.filter((f) => f.toLowerCase().endsWith(".mp4"))
  if (mp4s.length === 0) return null
  let newest: { path: string; mtime: number } | null = null
  for (const f of mp4s) {
    const p = join(rendersDir, f)
    const s = await stat(p)
    if (!newest || s.mtimeMs > newest.mtime) newest = { path: p, mtime: s.mtimeMs }
  }
  return newest?.path ?? null
}

/** 在 env 里就地把 dir 前置到 PATH（兼容 Windows 的 `Path` 大小写） */
function prependToPath(env: NodeJS.ProcessEnv, dir: string): void {
  const key = Object.keys(env).find((k) => k.toLowerCase() === "path") || "PATH"
  env[key] = dir + delimiter + (env[key] || "")
}

/**
 * 对一个 HyperFrames 项目目录跑 check + render。
 * @param projectDir 项目目录（含 index.html）
 */
export async function renderProject(projectDir: string, options: RenderOptions = {}): Promise<RenderResult> {
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000
  const ffmpegDir = await resolveFfmpegDir(options.ffmpegDir)
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (ffmpegDir) {
    prependToPath(env, ffmpegDir)
    logger.info("render:ffmpeg_prepended", { ffmpegDir })
  } else {
    logger.info("render:ffmpeg_on_path", {})
  }

  let checkPassed = true
  let checkOutput = ""
  if (!options.skipCheck) {
    logger.info("render:check_start", { projectDir })
    const check = await runCommand(`npx --yes hyperframes@${HF_VERSION} check`, projectDir, env, timeoutMs)
    checkPassed = check.code === 0
    checkOutput = check.output
    logger.info("render:check_done", { checkPassed })
  }

  const quality = options.quality || "high"
  logger.info("render:render_start", { projectDir, quality })
  const render = await runCommand(
    `npx --yes hyperframes@${HF_VERSION} render --quality ${quality}`,
    projectDir,
    env,
    timeoutMs
  )
  const videoPath = await findNewestMp4(projectDir)
  logger.info("render:render_done", { code: render.code, videoPath })

  return { checkPassed, checkOutput, videoPath, renderOutput: render.output }
}
