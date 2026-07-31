import { z } from 'zod'
import type { ProjectWorkflowKind } from '@/lib/workflow/project-workflow-registry'
import {
  addProjectVisualStyleIssues,
  projectVisualStyleSourceShape,
} from './project-visual-style'

export const PROJECT_SOURCE_SCHEMA_VERSION = 1 as const
export const PROJECT_SOURCE_VISUAL_THEMES = ['dark', 'light'] as const
export const WEBSITE_VIDEO_QUALITIES = ['draft', 'standard', 'high'] as const

const visualThemeSchema = z.enum(PROJECT_SOURCE_VISUAL_THEMES)
const storageKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      value.split('/').every((segment) => segment !== '' && segment !== '..'),
    'storageKey 必须是受控的相对对象键',
  )
const fileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\\/\u0000-\u001f]/u.test(value),
    'fileName 必须是安全的基础文件名',
  )

const scriptSourceSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SOURCE_SCHEMA_VERSION),
    kind: z.literal('script'),
    script: z.string().trim().min(1).max(200_000),
    visualTheme: visualThemeSchema,
    ...projectVisualStyleSourceShape,
  })
  .strict()

const audioSourceSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SOURCE_SCHEMA_VERSION),
    kind: z.literal('audio'),
    storageKey: storageKeySchema,
    fileName: fileNameSchema,
    mimeType: z.enum(['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave']),
    container: z.enum(['mp3', 'wav']),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sampleRate: z.number().int().min(8_000).max(192_000),
    sampleCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    visualTheme: visualThemeSchema,
    ...projectVisualStyleSourceShape,
  })
  .strict()

const websiteSourceSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SOURCE_SCHEMA_VERSION),
    kind: z.literal('website'),
    url: z.string().trim().min(1).max(2_048),
    durationSec: z.number().int().min(5).max(120),
    quality: z.enum(WEBSITE_VIDEO_QUALITIES),
    visualTheme: visualThemeSchema,
    ...projectVisualStyleSourceShape,
  })
  .strict()

export const projectSourcePayloadSchema = z
  .discriminatedUnion('kind', [
    scriptSourceSchema,
    audioSourceSchema,
    websiteSourceSchema,
  ])
  .superRefine(addProjectVisualStyleIssues)
  .transform((source, context) => {
    if (source.kind !== 'website') return source
    let parsed: URL
    try {
      parsed = new URL(source.url)
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'url 必须是有效的 HTTP(S) 地址',
      })
      return z.NEVER
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    ) {
      context.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'url 只允许不含内嵌凭据的 HTTP(S) 地址',
      })
      return z.NEVER
    }
    parsed.hash = ''
    return { ...source, url: parsed.toString() }
  })

export type ProjectSourcePayload = z.output<typeof projectSourcePayloadSchema>
export type ScriptProjectSourcePayload = Extract<
  ProjectSourcePayload,
  { kind: 'script' }
>
export type AudioProjectSourcePayload = Extract<
  ProjectSourcePayload,
  { kind: 'audio' }
>
export type WebsiteProjectSourcePayload = Extract<
  ProjectSourcePayload,
  { kind: 'website' }
>

export interface ProjectSourceRecord {
  workspaceId: string
  projectId: string
  kind: ProjectWorkflowKind
  sourcePayload: ProjectSourcePayload
  sourceFingerprint: string
  createdAt: Date
  updatedAt: Date
}

export function parseProjectSourcePayload(input: unknown): ProjectSourcePayload {
  return projectSourcePayloadSchema.parse(input)
}
