// CLI：从 capture/ 目录或 URL 生成 video.mp4（方案 B 模板管线）。
//
// 用法（server/ 下）：
//   npx tsx scripts/render-capture.ts <captureDir|url> [选项]
//
// 位置参数：
//   传目录 → 直接渲染该 capture/；传 http(s) URL → 先采集再渲染（端到端）
//
// 通用选项：
//   --out <dir>        项目输出目录（默认 <captureDir>/../<id>-video）
//   --duration <sec>   目标时长秒（默认 30）
//   --name <name>      覆盖展示名
//   --quality <q>      渲染质量 high|medium|low|draft（默认 high）
//   --skip-check       跳过 hyperframes check
//   --ffmpeg <dir>     手动指定 ffmpeg 所在 bin 目录
//
// URL 模式额外选项（透传给采集）：
//   --mock             无浏览器冒烟（mock driver）
//   --no-vision        不用 StepFun 视觉描述
//   --email/--password 测试账号；--min/--max/--steps 截图与步数；--headful 有头
//
// 示例：
//   npx tsx scripts/render-capture.ts ./out/example --duration 24
//   npx tsx scripts/render-capture.ts https://example.com --mock --duration 20 --quality draft
import { dirname, join, isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "../src/lib/load-env"
import { renderFromCapture, urlToVideo, type UrlToVideoOptions } from "../src/compose/run-pipeline"
import type { RunCaptureOptions } from "../src/capture/run-capture"
import type { DriverType } from "../src/capture/browser-driver"

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")
const REPO_ROOT = join(SERVER_ROOT, "..")

interface ParsedArgs {
  target?: string
  opts: UrlToVideoOptions
}

function parseArgs(argv: string[]): ParsedArgs {
  const opts: UrlToVideoOptions = {}
  const capture: RunCaptureOptions = {}
  let target: string | undefined
  let usedCapture = false

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      // 通用
      case "--out": { const v = next(); if (v) opts.projectDir = v; break }
      case "--duration": opts.durationSec = Number(next()); break
      case "--name": { const v = next(); if (v) opts.name = v; break }
      case "--quality": { const v = next(); if (v) opts.quality = v; break }
      case "--skip-check": opts.skipCheck = true; break
      case "--ffmpeg": { const v = next(); if (v) opts.ffmpegDir = v; break }
      // 采集透传（仅 URL 模式生效）
      case "--driver": { const v = next(); if (v) capture.driver = v as DriverType; usedCapture = true; break }
      case "--mock": capture.driver = "mock"; usedCapture = true; break
      case "--no-vision": capture.useVision = false; usedCapture = true; break
      case "--email": { const v = next(); if (v) capture.testEmail = v; usedCapture = true; break }
      case "--password": { const v = next(); if (v) capture.testPassword = v; usedCapture = true; break }
      case "--desc": { const v = next(); if (v) capture.description = v; usedCapture = true; break }
      case "--min": capture.minScreenshots = Number(next()); usedCapture = true; break
      case "--max": capture.maxScreenshots = Number(next()); usedCapture = true; break
      case "--steps": capture.maxSteps = Number(next()); usedCapture = true; break
      case "--headful": capture.headful = true; usedCapture = true; break
      default:
        if (a && !a.startsWith("--") && !target) target = a
        else console.warn(`[render-capture] 忽略未知参数：${a}`)
    }
  }
  if (usedCapture) opts.capture = capture
  return { ...(target != null ? { target } : {}), opts }
}

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

async function main(): Promise<void> {
  await loadEnv(join(SERVER_ROOT, ".env"))
  await loadEnv(join(REPO_ROOT, ".env.local"))

  const { target, opts } = parseArgs(process.argv.slice(2))
  if (!target) {
    console.error("用法：npx tsx scripts/render-capture.ts <captureDir|url> [--duration 30] [--quality high] [--mock] ...")
    process.exit(2)
  }

  const startedAt = Date.now()
  let result

  if (isUrl(target)) {
    console.log(`[render-capture] 端到端：${target}`)
    result = await urlToVideo(target, opts)
  } else {
    const captureDir = isAbsolute(target) ? target : resolve(process.cwd(), target)
    console.log(`[render-capture] 从 capture 渲染：${captureDir}`)
    result = await renderFromCapture(captureDir, opts)
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\n[render-capture] 用时 ${secs}s`)
  console.log(`[render-capture] 项目目录：${result.projectDir}`)
  console.log(`[render-capture] check：${result.checkPassed ? "通过" : "未通过（见日志）"}`)
  if (result.videoPath) {
    console.log(`[render-capture] ✅ 视频：${result.videoPath}`)
  } else {
    console.error(`[render-capture] ❌ 未产出 mp4，检查上面的 render 日志`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("[render-capture] 失败：", err)
  process.exit(1)
})
