// 编排器：把 AdapterInput 写成 HyperFrames 官方 capture/ 目录。
// 产出：capture/{meta.json, assets/NN-slug.png, extracted/{tokens.json, visible-text.txt, asset-descriptions.md}}
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { serializeTokens } from "./build-tokens"
import { buildVisibleText } from "./build-visible-text"
import { describeAssets, type AssetToDescribe } from "./describe-assets"
import type { AdapterInput, AdapterManifest, AdapterOptions, PageTokens, WrittenAsset } from "./types"

/** 文件名 slug：保留 ascii 字母数字，其余转连字符；中文等无法转写时返回空串 */
function slugify(label: string): string {
  return (label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** pageTokens 缺省时的下限：至少给出 title/description */
function minimalPageTokens(input: AdapterInput): PageTokens {
  const firstTitle = input.snapshots[0]?.title
  return { title: input.pageTokens?.title || firstTitle || input.name }
}

/**
 * 运行 Capture 适配器。
 * @returns 写盘清单（含各资产的最终描述）
 */
export async function runCaptureAdapter(
  input: AdapterInput,
  options: AdapterOptions = {}
): Promise<AdapterManifest> {
  const outDir = options.outDir || join(process.cwd(), "capture")
  const assetsDir = join(outDir, "assets")
  const extractedDir = join(outDir, "extracted")
  await mkdir(assetsDir, { recursive: true })
  await mkdir(extractedDir, { recursive: true })

  // 1. 规划截图落盘路径（NN-slug.png），写入 assets/
  const toDescribe: AssetToDescribe[] = []
  for (let i = 0; i < input.capture.screenshots.length; i++) {
    const shot = input.capture.screenshots[i]!
    const slug = slugify(shot.label) || shot.metadata.pageType || "shot"
    const filename = `${pad2(i)}-${slug}.png`
    const relPath = `assets/${filename}`
    await writeFile(join(assetsDir, filename), shot.buffer)
    toDescribe.push({
      path: relPath,
      label: shot.label,
      metadata: shot.metadata,
      buffer: shot.buffer,
      mediaType: "image/png",
    })
  }

  // 2. asset-descriptions.md（StepFun 视觉描述，缺 key 自动降级）
  const useVision = options.useVision ?? true
  const described = await describeAssets(toDescribe, useVision)
  await writeFile(join(extractedDir, "asset-descriptions.md"), described.markdown, "utf8")

  // 3. visible-text.txt
  const visibleText = buildVisibleText(input.snapshots)
  await writeFile(join(extractedDir, "visible-text.txt"), visibleText, "utf8")

  // 4. tokens.json
  const pageTokens = input.pageTokens ?? minimalPageTokens(input)
  await writeFile(join(extractedDir, "tokens.json"), serializeTokens(pageTokens), "utf8")

  // 5. meta.json
  const meta = { id: input.id, name: input.name }
  await writeFile(join(outDir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8")

  const assets: WrittenAsset[] = toDescribe.map((a) => ({
    path: a.path,
    label: a.label,
    description: described.descriptions.get(a.path) || "",
  }))

  return {
    outDir,
    assets,
    files: [
      "meta.json",
      "extracted/tokens.json",
      "extracted/visible-text.txt",
      "extracted/asset-descriptions.md",
      ...assets.map((a) => a.path),
    ],
    visionUsed: described.visionUsed,
  }
}
