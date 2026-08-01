// 对拍验证：用官方金样本 _capture_probe 的材料构造 AdapterInput，
// 跑 runCaptureAdapter 写到临时 capture/ 目录，断言 Step1 Gate 的结构 / 格式与金样本对齐。
//
// 用法（server/ 下）：
//   npx tsx scripts/verify-golden.ts            # 纯结构对拍（不打 StepFun）
//   npx tsx scripts/verify-golden.ts --vision   # 额外用 StepFun 实测一张截图的视觉描述
//
// 退出码 0 = 全部通过；非 0 = 有断言失败。
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { runCaptureAdapter } from "../src/adapter/index"
import { describeAssets, type AssetToDescribe } from "../src/adapter/describe-assets"
import type { AdapterInput, PageTokens, StepSnapshot } from "../src/adapter/types"
import type { CapturedScreenshot } from "../src/types/capture.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, "..")
const REPO_ROOT = join(SERVER_ROOT, "..")
const PROBE = join(SERVER_ROOT, "..", "_capture_probe")

// --- 极简 .env 加载（不引依赖）：唯一环境文件是仓库根 `.env.local` ---
async function loadEnv(): Promise<void> {
  const envPath = join(REPO_ROOT, ".env.local")
  if (!existsSync(envPath)) return
  const raw = await readFile(envPath, "utf8")
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const eq = t.indexOf("=")
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}

// --- 断言框架 ---
let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

// --- 从金样本 tokens.json 造 pageTokens ---
async function loadGoldenTokens(): Promise<PageTokens> {
  const raw = await readFile(join(PROBE, "extracted", "tokens.json"), "utf8")
  return JSON.parse(raw) as PageTokens
}

// --- 造截图（复用金样本 screenshots 里的真实 PNG）---
async function loadScreenshots(): Promise<CapturedScreenshot[]> {
  const dir = join(PROBE, "screenshots")
  const specs: Array<{ file: string; label: string }> = [
    { file: "scroll-000.png", label: "Hero — top of page" },
    { file: "scroll-090.png", label: "Components showcase" },
    { file: "scroll-100.png", label: "Footer and CTA" },
  ]
  const out: CapturedScreenshot[] = []
  for (const s of specs) {
    const buffer = await readFile(join(dir, s.file))
    out.push({
      buffer,
      label: s.label,
      metadata: { pageType: "marketing", pageUrl: "https://ui.shadcn.com", captureMode: "capture" },
    })
  }
  return out
}

// --- 从 golden headings/ctas 造 snapshots（证明 visible-text 生成）---
function buildSnapshots(tokens: PageTokens): StepSnapshot[] {
  let ref = 0
  const elements: StepSnapshot["elements"] = []
  for (const h of tokens.headings ?? []) {
    elements.push({
      ref: ref++,
      tag: `h${h.level}`,
      role: "heading",
      text: h.text,
      selector: `h${h.level}`,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  }
  for (const c of tokens.ctas ?? []) {
    elements.push({
      ref: ref++,
      tag: "a",
      role: "link",
      text: c.text,
      selector: "a",
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    })
  }
  return [
    {
      title: tokens.title,
      url: "https://ui.shadcn.com",
      elements,
      textContent: elements.map((e) => e.text).join(" "),
    },
  ]
}

async function main(): Promise<void> {
  await loadEnv()
  const wantVision = process.argv.includes("--vision")

  const goldenTokens = await loadGoldenTokens()
  const screenshots = await loadScreenshots()
  const snapshots = buildSnapshots(goldenTokens)

  const input: AdapterInput = {
    id: "ui.shadcn.com-video",
    name: goldenTokens.title,
    capture: { screenshots, actions: [] },
    snapshots,
    pageTokens: goldenTokens,
  }

  const outDir = await mkdtemp(join(tmpdir(), "purpleink-capture-"))
  console.log(`\n[1] runCaptureAdapter → ${outDir}\n`)

  // 结构对拍不打网络：useVision:false
  const manifest = await runCaptureAdapter(input, { outDir, useVision: false })

  console.log("[2] Gate 结构断言\n")
  check("meta.json 存在", existsSync(join(outDir, "meta.json")))
  check("extracted/tokens.json 存在", existsSync(join(outDir, "extracted", "tokens.json")))
  check("extracted/visible-text.txt 存在", existsSync(join(outDir, "extracted", "visible-text.txt")))
  check("extracted/asset-descriptions.md 存在", existsSync(join(outDir, "extracted", "asset-descriptions.md")))
  const assetFiles = await readdir(join(outDir, "assets"))
  check("assets/ 截图数 == 输入", assetFiles.length === screenshots.length, `got ${assetFiles.length}`)
  check("assets/ 命名为 NN-slug.png", assetFiles.every((f) => /^\d\d-[a-z0-9-]+\.png$/.test(f)), assetFiles.join(","))

  console.log("\n[3] tokens.json 格式对拍\n")
  const outTokensRaw = await readFile(join(outDir, "extracted", "tokens.json"), "utf8")
  check("tokens.json 以换行结尾", outTokensRaw.endsWith("}\n"))
  check("tokens.json 用 2 空格缩进", outTokensRaw.includes('\n  "title"'))
  const outTokens = JSON.parse(outTokensRaw) as Record<string, unknown>
  const goldenKeys = new Set(Object.keys(goldenTokens as unknown as Record<string, unknown>))
  const outKeys = Object.keys(outTokens)
  check("tokens.json 无金样本之外的多余键", outKeys.every((k) => goldenKeys.has(k)), outKeys.filter((k) => !goldenKeys.has(k)).join(","))
  for (const core of ["title", "description", "cssVariables", "fonts", "colors"]) {
    check(`tokens.json 含核心键 ${core}`, core in outTokens)
  }
  check("title 与金样本一致", outTokens.title === goldenTokens.title)
  check("colors 全大写十六进制", (outTokens.colors as string[]).every((c) => /^#[0-9A-F]+$/.test(c)))

  console.log("\n[4] visible-text.txt 格式对拍\n")
  const outVisible = await readFile(join(outDir, "extracted", "visible-text.txt"), "utf8")
  const vlines = outVisible.split("\n").filter((l) => l.length > 0)
  check("visible-text 非空", vlines.length > 0, `${vlines.length} 行`)
  check("每行匹配 [tag] text 格式", vlines.every((l) => /^\[[a-z0-9]+\] .+/.test(l)), vlines.find((l) => !/^\[[a-z0-9]+\] .+/.test(l)) || "")

  console.log("\n[5] asset-descriptions.md 格式对拍\n")
  const outMd = await readFile(join(outDir, "extracted", "asset-descriptions.md"), "utf8")
  check("以 # Asset Descriptions 开头", outMd.startsWith("# Asset Descriptions"))
  const mdItems = outMd.split("\n").filter((l) => l.startsWith("- "))
  check("每张截图一条描述", mdItems.length === screenshots.length, `${mdItems.length} 条`)
  check("描述行格式 `- assets/xx — desc`", mdItems.every((l) => /^- assets\/.+ — .+/.test(l)), mdItems[0] || "")

  console.log("\n[6] manifest 自洽\n")
  check("manifest.files 含 4 个 gate 文件 + N 张图", manifest.files.length === 4 + screenshots.length, String(manifest.files.length))
  check("manifest.visionUsed == false（本次禁用）", manifest.visionUsed === false)

  // --- 可选：StepFun 视觉实测（证明比金样本弱描述更丰富）---
  if (wantVision) {
    console.log("\n[7] StepFun 视觉实测（step-explore）\n")
    if (!process.env.STEP_API_KEY) {
      check("STEP_API_KEY 已配置", false, " 未在根 .env.local 找到 STEP_API_KEY")
    } else {
      const buffer = await readFile(join(PROBE, "assets", "dashboard.jpg"))
      const one: AssetToDescribe[] = [
        {
          path: "assets/00-dashboard.jpg",
          label: "Dashboard example",
          metadata: { pageType: "product" },
          buffer,
          mediaType: "image/jpeg",
        },
      ]
      const res = await describeAssets(one, true)
      const desc = res.descriptions.get("assets/00-dashboard.jpg") || ""
      console.log(`     StepFun 描述: ${desc}`)
      check("visionUsed == true", res.visionUsed === true)
      check("描述比金样本弱描述更长（>20 字）", desc.length > 20, `len=${desc.length}`)
    }
  } else {
    console.log("\n[7] StepFun 视觉实测已跳过（加 --vision 开启）\n")
  }

  await rm(outDir, { recursive: true, force: true })

  console.log(`\n==== 结果：${passed} 通过 / ${failed} 失败 ====\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("验证脚本崩溃:", err)
  process.exit(1)
})
