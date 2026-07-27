/**
 * 设置面 Provider 写入的阶段间合同（纯类型 + 构造器，无 I/O）。
 *
 * `src/app/api/settings/route.ts` 只做 JSON 解析、schema 校验与响应映射；
 * 「哪些闸门、什么顺序、失败回什么状态码」属于业务状态机，留在 features 层
 * （AGENTS §3）。顺序本身是合同：任何一道校验失败都不得落下任何 secret、模型、
 * 路由或配额写入（AGENTS §7）。
 */

/** 被拒绝时的完整响应体，形状与历史响应逐字一致，避免客户端解析口径漂移。 */
export interface ProviderSettingsRejection {
  status: 400 | 422
  body: {
    ok: false
    valid?: false
    error: string
    /** 机器可读的失败类别，仅在客户端需要据此改变提交方式时出现。 */
    reason?: 'asr-transcription-rejected'
  }
}

export interface AsrNegotiation {
  timestampMode: 'segment' | 'none'
  verification: 'transcription' | 'credential-only'
}

/**
 * 校验阶段协商出来、保存阶段要用的结果。
 *
 * 显式在两个阶段间传递而不是放模块级缓存：设置写入是并发可达的，模块级状态会让
 * 两个请求互相串用对方的协商结果。重跑一次真实转写又会多花一次外部调用。
 */
export interface ProviderSettingsNegotiation {
  asr?: AsrNegotiation
}

export type ProviderSettingsOutcome =
  | { ok: true; negotiated?: ProviderSettingsNegotiation }
  | { ok: false; rejection: ProviderSettingsRejection }

/** 保守默认：协商结果缺失时按「无时间戳、仅校验过凭据」处理，不猜 segment。 */
export const CONSERVATIVE_ASR_NEGOTIATION: AsrNegotiation = {
  timestampMode: 'none',
  verification: 'credential-only',
}

export const OK: ProviderSettingsOutcome = { ok: true }

export function reject(
  status: 400 | 422,
  error: string,
  valid?: false,
): ProviderSettingsOutcome {
  return {
    ok: false,
    rejection: {
      status,
      body: valid === undefined ? { ok: false, error } : { ok: false, valid, error },
    },
  }
}

export function httpSuffix(status?: number): string {
  return status === undefined ? '' : `（HTTP ${status}）`
}
