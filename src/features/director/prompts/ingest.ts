import { z } from 'zod'
import { audioManifestSchema, scriptUnitsSchema } from '../schemas/ingest'

export const ingestPromptInputSchema = z
  .object({
    rawScript: z.string().min(1),
    existingUnits: scriptUnitsSchema.optional(),
    existingAudioManifest: audioManifestSchema.optional(),
  })
  .strict()

export type IngestPromptInput = z.infer<typeof ingestPromptInputSchema>

/** 构建 INGEST 阶段的项目原生提示词。 */
export function buildIngestPrompt(input: IngestPromptInput): string {
  const parsed = ingestPromptInputSchema.parse(input)
  return `你正在执行 CodeVideoCanvas 的 Demo INGEST 阶段。

目标：
1. 保持原文事实、限定语、疑问与顺序，不补写外部事实。
2. 把原稿拆成连续且不重叠的 script units，unitId 使用 U001 起的三位序号。
3. 拆分粒度按语义划分，平均每 1-2 句话一个 unit；为保持语义完整可超过 2 句，
   但禁止把多个独立语义点合并进同一个 unit。
4. 每个 unit 对应下游一个分镜泳道，拆分粒度直接决定镜头精度。
5. unit 总数不超过 999（unitId 三位序号上限）。
6. 每个 unit 只包含原稿中的连续文本；不要生成视觉方案、镜头代码或音频时长。
7. 音频 manifest/allocation 必须由应用根据实测媒体生成，不允许语言模型猜测。
8. 只返回一个严格 JSON 对象，格式为：
{"scriptUnits":[{"unitId":"U001","text":"原稿中的连续文本","order":0}]}
9. 不要使用 Markdown 代码围栏，不要添加解释或 JSON 之外的字符。

原始稿件：
${parsed.rawScript}

已有 script units（可能为空）：
${JSON.stringify(parsed.existingUnits ?? null)}

已有 audio manifest（可能为空）：
${JSON.stringify(parsed.existingAudioManifest ?? null)}

只返回上述严格 JSON 对象。`
}
