import 'server-only'
import { Script } from 'node:vm'

export type FabricateRuntimeInspection =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] }

const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
const RUNTIME_ASSIGNMENT = /\bwindow\s*\.\s*__CVC_RENDER__\s*=/
const RUNTIME_VERSION = /\bversion\s*:\s*1\b/
const RUNTIME_SEEK = /\bseek\s*(?::\s*function\s*|\()/

/** 提交前解析所有内联脚本，并锁定 Worker 消费的 __CVC_RENDER__@v1 静态合同。 */
export function inspectFabricateRuntime(
  source: string,
): FabricateRuntimeInspection {
  const errors: string[] = []
  const scripts = [...source.matchAll(INLINE_SCRIPT)]
  if (scripts.length === 0) {
    errors.push('FABRICATE HTML 必须包含内联 script')
  }
  for (const match of scripts) {
    const attributes = match[1] ?? ''
    if (/\bsrc\s*=/i.test(attributes)) {
      errors.push('FABRICATE HTML 不得依赖外部 script')
      continue
    }
    try {
      new Script(match[2] ?? '')
    } catch {
      errors.push(`脚本语法无效（第 ${lineOf(source, match.index ?? 0)} 行）`)
    }
  }
  if (
    !RUNTIME_ASSIGNMENT.test(source) ||
    !RUNTIME_VERSION.test(source) ||
    !RUNTIME_SEEK.test(source)
  ) {
    errors.push('必须安装 window.__CVC_RENDER__@v1 且提供 seek(frame, fps)')
  }
  return errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors }
}

function lineOf(source: string, index: number): number {
  return source.slice(0, Math.max(0, index)).split(/\r?\n/).length
}
