// 截图 → asset-descriptions.md。
// 官方金样本因没配 Vision key，描述很弱（"dashboard.jpg — dashboard"）；
// 我们用 StepFun 多模态给关键截图生成视觉级描述，喂给下游 Step3 分镜编导。
import { callWorkerModel } from "../ai/gateway-client"
import { logger } from "../lib/logger"
import type { ScreenshotMetadata } from "../types/capture"

export interface AssetToDescribe {
  /** 相对 capture/ 的路径，如 assets/00-dashboard.png */
  path: string
  label: string
  metadata: ScreenshotMetadata
  buffer: Buffer
  /** 图片 MIME（默认 image/png） */
  mediaType?: string
}

const VISION_SYSTEM =
  "You write concise, factual asset descriptions for a product demo video storyboard. " +
  "Reply with ONE English sentence describing what UI or feature the screenshot shows. " +
  "No preamble, no markdown, no bullet points, no guessing beyond what is visible."

/** 折叠成单行（asset-descriptions.md 每资产一行） */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/** 目录派生描述（无 Vision 时的兜底，等价官方无 key 的行为，但带上 aiDecision 语境） */
function catalogDescription(a: AssetToDescribe): string {
  const bits: string[] = []
  const label = oneLine(a.label || "")
  if (label) bits.push(label)
  if (a.metadata.pageType) bits.push(a.metadata.pageType)
  if (a.metadata.aiDecision) bits.push(a.metadata.aiDecision)
  return bits.join(" — ") || "screenshot"
}

/** 经统一 AI 网关描述单张截图；失败则抛出由上层降级。 */
async function visionDescribe(a: AssetToDescribe): Promise<string> {
  const text = await callWorkerModel({
    workload: "website-asset-description",
    systemPrompt: VISION_SYSTEM,
    maxOutputTokens: 800,
    content: [
      {
        type: "text",
        text:
          `Screenshot label: ${a.label || "(none)"}. ` +
          `Page type: ${a.metadata.pageType || "unknown"}. ` +
          `Describe what this screen shows in one sentence.`,
      },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: a.mediaType || "image/png",
          data: a.buffer.toString("base64"),
        },
      },
    ],
  })
  // 模型偶尔会包一层 JSON 或引号，做一次宽松清洗
  const cleaned = oneLine(text).replace(/^["'“”]+|["'“”]+$/g, "")
  return cleaned
}

export interface DescribeResult {
  markdown: string
  /** path → 最终描述（供 manifest 记录） */
  descriptions: Map<string, string>
  visionUsed: boolean
}

/**
 * 生成 asset-descriptions.md。
 * @param assets 已确定落盘路径的截图
 * @param useVision 是否启用工作区视觉路由；网关失败时按既有规则降级
 */
export async function describeAssets(
  assets: AssetToDescribe[],
  useVision: boolean
): Promise<DescribeResult> {
  const doVision = useVision
  const descriptions = new Map<string, string>()
  let visionUsed = false

  for (const a of assets) {
    let desc = catalogDescription(a)
    if (doVision) {
      try {
        const v = await visionDescribe(a)
        if (v) {
          desc = v
          visionUsed = true
        }
      } catch (err) {
        logger.warn("adapter:vision_describe_failed", { path: a.path, error: String(err) })
        // 保留目录派生描述作为兜底
      }
    }
    descriptions.set(a.path, desc)
  }

  const header = doVision
    ? "# Asset Descriptions\n\n> Vision descriptions generated through the workspace AI route.\n"
    : "# Asset Descriptions\n\n> Catalog-derived descriptions (Vision disabled).\n"

  const body = assets.map((a) => `- ${a.path} — ${descriptions.get(a.path)}`).join("\n")
  const markdown = `${header}\n${body}\n`

  return { markdown, descriptions, visionUsed }
}
