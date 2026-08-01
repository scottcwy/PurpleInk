// CLI：采集一个 URL → 写出 HyperFrames 官方 capture/ 目录。
//
// 用法（server/ 下）：
//   npx tsx scripts/capture-url.ts <url> [选项]
//
// 选项：
//   --out <dir>        输出目录（默认 ./capture）
//   --driver <type>    playwright | mock（默认读 BROWSER_DRIVER，未设则 playwright）
//   --mock             等价 --driver mock（无浏览器冒烟）
//   --no-vision        不用 StepFun 视觉描述（截图仍写盘，描述走目录派生）
//   --name <name>      项目展示名
//   --id <id>          项目 id
//   --desc <text>      产品一句话简介（帮 Agent 判断核心功能）
//   --email <email>    测试账号邮箱（提供则登录优先）
//   --password <pwd>   测试账号密码
//   --min <n>          最少截图数（默认 4）
//   --max <n>          最多截图数（默认 8）
//   --steps <n>        Agent 最大决策步数（默认 24）
//   --headful          有头浏览器（调试用）
//
// 示例：
//   npx tsx scripts/capture-url.ts https://example.com --mock --out ./out/example
//   npx tsx scripts/capture-url.ts https://myapp.dev --desc "AI 笔记工具" --min 5
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnv } from "../src/lib/load-env"
import { runCapture, type RunCaptureOptions } from "../src/capture/run-capture"
import type { DriverType } from "../src/capture/browser-driver"

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")
const REPO_ROOT = join(SERVER_ROOT, "..")

function parseArgs(argv: string[]): { url?: string; opts: RunCaptureOptions } {
  const opts: RunCaptureOptions = {}
  let url: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case "--out": { const v = next(); if (v) opts.outDir = v; break }
      case "--driver": { const v = next(); if (v) opts.driver = v as DriverType; break }
      case "--mock": opts.driver = "mock"; break
      case "--no-vision": opts.useVision = false; break
      case "--name": { const v = next(); if (v) opts.name = v; break }
      case "--id": { const v = next(); if (v) opts.id = v; break }
      case "--desc": { const v = next(); if (v) opts.description = v; break }
      case "--email": { const v = next(); if (v) opts.testEmail = v; break }
      case "--password": { const v = next(); if (v) opts.testPassword = v; break }
      case "--min": opts.minScreenshots = Number(next()); break
      case "--max": opts.maxScreenshots = Number(next()); break
      case "--steps": opts.maxSteps = Number(next()); break
      case "--headful": opts.headful = true; break
      default:
        if (a && !a.startsWith("--") && !url) url = a
        else console.warn(`[capture-url] 忽略未知参数：${a}`)
    }
  }
  return { ...(url != null ? { url } : {}), opts }
}

async function main(): Promise<void> {
  // 唯一环境文件：仓库根 `.env.local`。
  await loadEnv(join(REPO_ROOT, ".env.local"))

  const { url, opts } = parseArgs(process.argv.slice(2))
  if (!url) {
    console.error("用法：npx tsx scripts/capture-url.ts <url> [--out dir] [--mock] [--no-vision] ...")
    process.exit(2)
  }

  console.log(`[capture-url] 采集 ${url}`)
  console.log(`[capture-url] driver=${opts.driver ?? process.env.BROWSER_DRIVER ?? "playwright"} vision=${opts.useVision ?? true}`)

  const startedAt = Date.now()
  const manifest = await runCapture(url, opts)
  const secs = ((Date.now() - startedAt) / 1000).toFixed(1)

  console.log(`\n[capture-url] ✅ 完成，用时 ${secs}s`)
  console.log(`[capture-url] 输出目录：${manifest.outDir}`)
  console.log(`[capture-url] 视觉描述：${manifest.visionUsed ? "StepFun 视觉" : "目录派生（降级）"}`)
  console.log(`[capture-url] 截图 ${manifest.assets.length} 张：`)
  for (const a of manifest.assets) {
    console.log(`  - ${a.path}  ${a.label}`)
  }
  console.log(`[capture-url] 产物文件：`)
  for (const f of manifest.files) console.log(`  - ${f}`)
}

main().catch((err) => {
  console.error("[capture-url] 失败：", err)
  process.exit(1)
})
