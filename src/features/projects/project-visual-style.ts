import { z } from 'zod'

export const PROJECT_VISUAL_STYLES = [
  'default',
  'flat',
  'dimensional',
  'custom',
] as const
export const PROJECT_VISUAL_STYLE_FORM_FIELDS = [
  'visualStyle',
  'customVisualStyle',
] as const

export const projectVisualStyleSchema = z.enum(PROJECT_VISUAL_STYLES)

export type ProjectVisualStyle = z.infer<typeof projectVisualStyleSchema>

export const projectVisualStyleSourceShape = {
  visualStyle: projectVisualStyleSchema.optional(),
  customVisualStyle: z.string().trim().min(1).max(500).optional(),
}

export const projectVisualStyleRequestShape = {
  visualStyle: projectVisualStyleSchema.default('default'),
  customVisualStyle: z.string().trim().min(1).max(500).optional(),
}

const projectVisualStyleInputSchema = z
  .object(projectVisualStyleRequestShape)
  .superRefine(addProjectVisualStyleIssues)

export function addProjectVisualStyleIssues(
  input: {
    visualStyle?: ProjectVisualStyle
    customVisualStyle?: string
  },
  context: z.RefinementCtx,
): void {
  if (input.visualStyle === 'custom' && !input.customVisualStyle) {
    context.addIssue({
      code: 'custom',
      path: ['customVisualStyle'],
      message: '自定义风格必须提供具体要求',
    })
  }
  if (input.visualStyle !== 'custom' && input.customVisualStyle) {
    context.addIssue({
      code: 'custom',
      path: ['customVisualStyle'],
      message: '只有自定义风格可以提供额外要求',
    })
  }
}

export function normalizeProjectVisualStyle(input: unknown): {
  visualStyle?: ProjectVisualStyle
  customVisualStyle?: string
} {
  const parsed = projectVisualStyleInputSchema.parse(input)
  if (parsed.visualStyle === 'default') return {}
  if (parsed.visualStyle === 'custom') {
    return {
      visualStyle: parsed.visualStyle,
      customVisualStyle: parsed.customVisualStyle,
    }
  }
  return { visualStyle: parsed.visualStyle }
}

export function readProjectVisualStyleFormData(
  form: FormData,
  invalidInput: () => Error,
) {
  try {
    return normalizeProjectVisualStyle({
      visualStyle: form.get('visualStyle') ?? undefined,
      customVisualStyle: form.get('customVisualStyle') ?? undefined,
    })
  } catch {
    throw invalidInput()
  }
}
