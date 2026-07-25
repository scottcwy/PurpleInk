import { z } from 'zod'

export const visualThemeSchema = z.enum(['dark', 'light'])

export type VisualTheme = z.infer<typeof visualThemeSchema>

export const DEFAULT_VISUAL_THEME: VisualTheme = 'dark'

/** 解析项目色调；非法或缺失时回落默认深色系。 */
export function resolveVisualTheme(value: unknown): VisualTheme {
  const parsed = visualThemeSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_VISUAL_THEME
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
