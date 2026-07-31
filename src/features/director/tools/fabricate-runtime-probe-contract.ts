export interface FabricateRuntimeViolation {
  ruleId:
    | 'runtime-page-script'
    | 'runtime-missing'
    | 'runtime-version'
    | 'runtime-seek'
    | 'runtime-master-geometry'
    | 'runtime-seek-script'
    | 'runtime-seek-timeout'
    | 'runtime-fonts-timeout'
  message: string
}

export interface FabricateRuntimeProbeOptions {
  signal?: AbortSignal
  operationTimeoutMs?: number
  totalTimeoutMs?: number
  tempRoot?: string
}

export type FabricateRuntimeProbe = (
  source: string,
  options?: FabricateRuntimeProbeOptions,
) => Promise<FabricateRuntimeViolation[]>
