// 封装 hyperframes check + render 两步 CLI。
// 关键：ffmpeg 由 winget 用户作用域安装、不在默认 PATH，这里自动定位并前置到子进程 PATH。
import { spawn } from "node:child_process"
import { readdir, stat, readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { logger } from "../lib/logger"

export const HYPERFRAMES_VERSION = "0.7.70"

export function getHyperframesCliPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const executable = process.platform === "win32" ? "hyperframes.cmd" : "hyperframes"
  return join(moduleDir, "..", "..", "..", "node_modules", ".bin", executable)
}

export interface RenderOptions {
  /** hyperframes render --quality（默认 standard） */
  quality?: string
  /** 跳过 check（默认 false） */
  skipCheck?: boolean
  /** 手动指定 ffmpeg 所在 bin 目录（覆盖自动探测） */
  ffmpegDir?: string
  /** 单步超时 ms（默认 20 分钟，覆盖 60–120s 正片） */
  timeoutMs?: number
  /** 渲染帧率（可选，追加 --fps 参数） */
  fps?: number
  signal?: AbortSignal
}

export interface RenderResult {
  checkPassed: boolean
  checkOutput: string
  videoPath: string | null
  renderOutput: string
  goldenVerified: boolean
  goldenDetails: string[]
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
  timeoutMs: number,
  signal?: AbortSignal,
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
    const abort = () => {
      child.kill("SIGKILL")
      output += "\n[purpleink] cancelled\n"
    }
    signal?.addEventListener("abort", abort, { once: true })
    child.on("close", (code) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolve({ code: code ?? -1, output })
    })
    child.on("error", (err) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
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
  options.signal?.throwIfAborted()
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
    const hyperframesCli = `"${getHyperframesCliPath()}"`
    const check = await runCommand(
      `${hyperframesCli} check`,
      projectDir,
      env,
      timeoutMs,
      options.signal,
    )
    options.signal?.throwIfAborted()
    checkPassed = check.code === 0
    checkOutput = check.output
    logger.info("render:check_done", { checkPassed })
  }

  const quality = options.quality || "standard"
  logger.info("render:render_start", { projectDir, quality, fps: options.fps })
  let renderCmd = `"${getHyperframesCliPath()}" render --quality ${quality}`
  if (options.fps) renderCmd += ` --fps ${options.fps}`
  const render = await runCommand(
    renderCmd,
    projectDir,
    env,
    timeoutMs,
    options.signal,
  )
  options.signal?.throwIfAborted()
  const videoPath = await findNewestMp4(projectDir)
  logger.info("render:render_done", { code: render.code, videoPath })

  return { checkPassed, checkOutput, videoPath, renderOutput: render.output, goldenVerified: false, goldenDetails: [] }
}

/**
 * 渲染后金样本校验：验证根页面及其实际引用的章节结构与金样本对齐。
 * 采用与 verify-golden.ts 相同的 check() 断言风格：计数 passed/failed，逐条打印。
 */
export async function verifyGolden(projectDir: string): Promise<{ passed: boolean; details: string[]; passedCount: number; failedCount: number }> {
  const details: string[] = []
  let passedCount = 0
  let failedCount = 0

  function check(name: string, cond: boolean, detail = ""): void {
    if (cond) {
      passedCount++
      details.push(`  ✅ ${name}`)
    } else {
      failedCount++
      details.push(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`)
    }
  }

  const htmlPath = join(projectDir, "index.html")
  check("index.html 存在", existsSync(htmlPath))
  if (!existsSync(htmlPath)) {
    return { passed: false, details, passedCount, failedCount }
  }

  const rootHtml = await readFile(htmlPath, "utf8")
  const referencedHtml: string[] = []
  const compositionPattern = /data-composition-src=["']([^"']+\.html)["']/g
  for (const match of rootHtml.matchAll(compositionPattern)) {
    const compositionPath = resolve(projectDir, match[1])
    const relativePath = relative(projectDir, compositionPath)
    if (relativePath.startsWith("..") || isAbsolute(relativePath) || !existsSync(compositionPath)) continue
    referencedHtml.push(await readFile(compositionPath, "utf8"))
  }
  const html = [rootHtml, ...referencedHtml].join("\n")

  // 基础结构
  check("包含 GSAP CDN", html.includes("gsap@3"))
  check("包含 gsap.timeline", html.includes("gsap.timeline"))
  check("包含 data-skin", /data-skin="(editorial|kinetic|technical)"/.test(html))

  // 截图镜头容器
  check("包含 .window 容器", html.includes('class="window"'))
  check("包含 .viewport", html.includes('class="viewport"'))
  check("包含 shot-visual 类", html.includes("shot-visual"))

  // 无红绿黄圆点（已移除 macOS titlebar）
  check("无红绿黄圆点", !html.includes("#ff5f57") && !html.includes("#febc2e") && !html.includes("#28c840"), "titlebar dots should be removed")
  check("无 .titlebar 元素", !html.includes('class="titlebar"'))

  // 光晕 box-shadow
  check("window 有多层 box-shadow", html.includes("0 0 0 1px rgba(255,255,255") && html.includes("0 8px 40px rgba(0,0,0,0.3)"))

  // Ken Burns: x/y 偏移
  check("Ken Burns x 偏移", /x:\s*-?\d+/.test(html), "shot timeline should have x offset")
  check("Ken Burns y 偏移", /y:\s*-?\d+/.test(html), "shot timeline should have y offset")
  check(
    "Ken Burns 使用受支持缓动",
    /ease:\s*["'](?:power[1-4]\.(?:inOut|out)|expo\.out)["']/u.test(html),
  )

  // 分层入场: shot-visual opacity 动画
  check("分层入场 shot-visual 淡入", html.includes(".shot-visual") && html.includes("opacity"))

  // 视频产物
  const videoPath = await findNewestMp4(projectDir)
  check("视频产物存在", videoPath !== null, videoPath || "no mp4 found")

  details.push(`\n==== 金样本校验：${passedCount} 通过 / ${failedCount} 失败 ====`)

  return { passed: failedCount === 0, details, passedCount, failedCount }
}
