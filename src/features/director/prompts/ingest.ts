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
3. 每个 unit 只包含原稿中的连续文本；不要生成视觉方案、镜头代码或音频时长。
4. 音频 manifest/allocation 必须由应用根据实测媒体生成，不允许语言模型猜测。
5. 只返回一个严格 JSON 对象，格式为：
{"scriptUnits":[{"unitId":"U001","text":"原稿中的连续文本","order":0}]}
6. 不要使用 Markdown 代码围栏，不要添加解释或 JSON 之外的字符。

原始稿件：
${parsed.rawScript}

已有 script units（可能为空）：
${JSON.stringify(parsed.existingUnits ?? null)}

已有 audio manifest（可能为空）：
${JSON.stringify(parsed.existingAudioManifest ?? null)}

只返回上述严格 JSON 对象。`
}
