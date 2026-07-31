/**
 * 客户端可识别的「未登录 / 会话过期」错误类型（PLAN-002 §4.4 第 3 点）。
 *
 * 4 个客户端 api 模块把 401 统一映射成本类型，不各自 alert、不各自跳转；
 * 由 `useRequireLogin().handleAuthError` 识别后打开登录弹窗。
 * 本模块不带 'use client' / 'server-only' 指令：纯错误类型，两侧都能引用。
 */
export const UNAUTHENTICATED_CLIENT_MESSAGE = '登录已过期，请重新登录'

export class UnauthenticatedError extends Error {
  constructor() {
    super(UNAUTHENTICATED_CLIENT_MESSAGE)
    this.name = 'UnauthenticatedError'
  }
}

export function isUnauthenticatedError(value: unknown): value is UnauthenticatedError {
  return value instanceof UnauthenticatedError
}

/** 拿到响应后立刻调用：401 即抛可识别错误，业务分支不再各自处理。 */
export function throwIfUnauthenticated(response: Response): void {
  if (response.status === 401) throw new UnauthenticatedError()
}
