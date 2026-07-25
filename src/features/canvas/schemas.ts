import { z } from 'zod'
import type { CanvasNodeType } from './types'

export const createProjectSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200),
  script: z.string().default(''),
})

export const canvasNodeTypeSchema = z.enum([
  'script-import',
  'shot-split',
  'score',
  'export',
  'shot-script',
  'shot-codegen',
  'shot-sfx',
  'shot-subtitle',
  'shot-qa',
])

const genericNodeDataSchema = z.record(z.string(), z.unknown())

export const canvasNodeDataSchemas = {
  'script-import': genericNodeDataSchema,
  'shot-split': genericNodeDataSchema,
  score: genericNodeDataSchema,
  export: genericNodeDataSchema,
  'shot-script': genericNodeDataSchema,
  'shot-codegen': genericNodeDataSchema,
  'shot-sfx': genericNodeDataSchema,
  'shot-subtitle': genericNodeDataSchema,
  'shot-qa': genericNodeDataSchema,
} satisfies Record<CanvasNodeType, typeof genericNodeDataSchema>

export type CreateProjectInput = z.infer<typeof createProjectSchema>

// 导出设置校验与类型从canvas出口统一可得（单一事实源在 ./export-settings）。
export {
  exportSettingsSchema,
  type ExportSettings,
  type ResolutionPreset,
} from './export-settings'
