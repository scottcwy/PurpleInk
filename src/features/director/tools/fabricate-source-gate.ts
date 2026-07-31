import {
  inspectFabricateSource,
  type FabricateSourceInspection,
  type FabricateSourceViolation,
} from '@/features/canvas/contracts'
import {
  probeFabricateRuntime,
  type FabricateRuntimeProbe,
} from './fabricate-runtime-probe'

export type DeterminismInspection = FabricateSourceInspection

interface FabricateSourceGateOptions {
  probeRuntime?: FabricateRuntimeProbe
  signal?: AbortSignal
}

/** FABRICATE 唯一可信门禁顺序：静态合同通过后才允许执行 Chromium。 */
export async function inspectFabricateCandidate(
  source: string,
  options: FabricateSourceGateOptions = {},
): Promise<DeterminismInspection> {
  const staticInspection = inspectFabricateSource(source)
  if (!staticInspection.ok) return staticInspection

  const runtimeViolations = await (
    options.probeRuntime ?? probeFabricateRuntime
  )(source, { signal: options.signal })
  const violations: FabricateSourceViolation[] = runtimeViolations.map(
    (violation) => ({
      ...violation,
      line: 1,
      snippet: '',
    }),
  )
  return violations.length === 0
    ? { ok: true, violations: [] }
    : { ok: false, violations }
}
