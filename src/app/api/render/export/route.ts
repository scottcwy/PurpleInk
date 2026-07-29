import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiSession } from '@/features/auth/api-session'
import { requestExportFinalization } from '@/features/director/export-finalization'
import {
  ensureShotQaChecked,
  getExportReadiness,
} from '@/features/render/export-service'
import { initQueue } from '@/lib/queue/init'
import { assertProjectWorkflowSupported } from '@/features/projects/project-compatibility'

export const dynamic = 'force-dynamic'

const requestSchema = z
  .object({
    projectId: z.string().min(1),
    degraded: z.boolean().optional(),
    confirmationFingerprint: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (input) => input.degraded !== true || input.confirmationFingerprint !== undefined,
    { message: '确认降级导出时必须携带 confirmationFingerprint' },
  )
  .refine(
    (input) => input.degraded === true || input.confirmationFingerprint === undefined,
    { message: '仅降级确认允许携带 confirmationFingerprint' },
  )

export function GET(request: Request): Promise<Response> {
  return withApiSession(() => handleGet(request))
}

async function handleGet(request: Request) {
  const projectId = new URL(request.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ ok: false, error: '缺少 projectId' }, { status: 400 })
  }
  try {
    await assertProjectWorkflowSupported(projectId)
    // best-effort：QA 检测失败（如缩略图截取异常）不阻断 readiness 返回。
    try {
      await ensureShotQaChecked(projectId)
    } catch (error) {
      console.error(
        `[render/export] QA 检测触发失败：${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    const { finalArtifactId, ...readiness } = await getExportReadiness(projectId)
    return NextResponse.json({
      ok: true,
      ...readiness,
      artifactUrl: finalArtifactId
        ? `/api/artifacts/${finalArtifactId}?projectId=${encodeURIComponent(projectId)}`
        : null,
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '导出状态读取失败' },
      { status: 404 }
    )
  }
}

export function POST(request: Request): Promise<Response> {
  return withApiSession(() => handlePost(request))
}

async function handlePost(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: '请求体无效' }, { status: 400 })
  }
  try {
    await assertProjectWorkflowSupported(parsed.data.projectId)
    await initQueue()
    const finalization = await requestExportFinalization({
      projectId: parsed.data.projectId,
      trigger: parsed.data.degraded === true
        ? 'confirmed-degraded'
        : 'manual-node',
      ...(parsed.data.confirmationFingerprint
        ? { confirmationFingerprint: parsed.data.confirmationFingerprint }
        : {}),
    })
    if (finalization.status === 'blocked') {
      return NextResponse.json(
        {
          ok: false,
          code: finalization.block.code,
          error: finalization.block.message,
          confirmationFingerprint: finalization.block.confirmationFingerprint,
        },
        { status: 409 }
      )
    }
    return NextResponse.json({
      ok: true,
      jobId: finalization.jobId,
    })
  } catch (error) {
    if (
      error instanceof Error
      && error.name === 'ExportFinalizationNotReadyError'
    ) {
      const details = readSafeDetails(error)
      return NextResponse.json({
        ok: false,
        code: 'EXPORT_NOT_READY',
        error: error.message,
        incompleteNodeIds: details.incompleteNodeIds,
        blockingIssues: details.blockingIssues,
      }, { status: 409 })
    }
    if (
      error instanceof Error
      && error.name === 'StaleDegradedConfirmationError'
    ) {
      return NextResponse.json({
        ok: false,
        code: 'DEGRADED_CONFIRMATION_STALE',
        error: error.message,
      }, { status: 409 })
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : '终片导出失败',
      },
      { status: 409 }
    )
  }
}

function readSafeDetails(error: Error): {
  incompleteNodeIds: string[]
  blockingIssues: unknown[]
} {
  const value = (error as Error & { safeDetails?: unknown }).safeDetails
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { incompleteNodeIds: [], blockingIssues: [] }
  }
  const details = value as Record<string, unknown>
  return {
    incompleteNodeIds: Array.isArray(details.incompleteNodeIds)
      ? details.incompleteNodeIds.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    blockingIssues: Array.isArray(details.blockingIssues)
      ? details.blockingIssues
      : [],
  }
}
