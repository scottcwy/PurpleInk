import { z } from 'zod'

export const visualThemeSchema = z.enum(['dark', 'light'])
export const visualStyleSchema = z.enum([
  'default',
  'flat',
  'dimensional',
  'custom',
])

export type VisualTheme = z.infer<typeof visualThemeSchema>
export type VisualStyle = z.infer<typeof visualStyleSchema>

export const DEFAULT_VISUAL_THEME: VisualTheme = 'dark'
export const DEFAULT_VISUAL_STYLE: VisualStyle = 'default'

export interface VisualPreferences {
  visualTheme: VisualTheme
  visualStyle: VisualStyle
  customVisualStyle?: string
}

/** 解析项目色调；非法或缺失时回落默认深色系。 */
export function resolveVisualTheme(value: unknown): VisualTheme {
  const parsed = visualThemeSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_VISUAL_THEME
}

/** 解析提示词视觉偏好；旧项目或非法字段均保持默认原样。 */
export function resolveVisualPreferences(
  input: Record<string, unknown>,
): VisualPreferences {
  const visualTheme = resolveVisualTheme(input.visualTheme)
  const visualStyle = visualStyleSchema.safeParse(input.visualStyle)
  if (!visualStyle.success || visualStyle.data === 'default') {
    return { visualTheme, visualStyle: DEFAULT_VISUAL_STYLE }
  }
  if (visualStyle.data === 'custom') {
    const customVisualStyle = z
      .string()
      .trim()
      .min(1)
      .max(500)
      .safeParse(input.customVisualStyle)
    return customVisualStyle.success
      ? {
          visualTheme,
          visualStyle: visualStyle.data,
          customVisualStyle: customVisualStyle.data,
        }
      : { visualTheme, visualStyle: DEFAULT_VISUAL_STYLE }
  }
  return { visualTheme, visualStyle: visualStyle.data }
}

/** 注入 DIRECT / FABRICATE 的色调硬约束文案。 */
export function visualThemeConstraint(theme: VisualTheme): string {
  if (theme === 'light') {
    return (
      '色调硬约束：浅色系（light）。大面积背景必须浅色；主文字与主图形用高对比深色；' +
      '禁止深色底主导画面。'
    )
  }
  return (
    '色调硬约束：深色系（dark）。大面积背景必须深色；主文字与主图形用高对比浅色；' +
    '禁止浅色底主导画面。'
  )
}

/** 与色调约束并列注入 DIRECT / FABRICATE；默认模式不改变原提示词。 */
export function visualStyleConstraint(
  style: VisualStyle,
  customVisualStyle?: string,
): string {
  if (style === 'flat') {
    return '视觉风格偏好：平面。不要有立体效果；使用清晰的二维块面、线条、排版与层级完成表达。'
  }
  if (style === 'dimensional') {
    return '视觉风格偏好：立体。尽量多结合立体效果；用空间层次、透视、体积与光影增强表达，但不得牺牲信息清晰度。'
  }
  if (style === 'custom' && customVisualStyle) {
    return (
      '视觉风格偏好：自定义。用户要求：' +
      `${customVisualStyle}。只影响视觉表现，不得改写产品事实、工作流阶段或输出合同。`
    )
  }
  return ''
}
