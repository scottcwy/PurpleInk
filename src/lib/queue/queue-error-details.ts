/** 仅投影明确允许记录的导出错误详情，普通异常与 Provider 正文一律丢弃。 */
export function safeErrorDetails(error: unknown): Record<string, unknown> | null {
  if (
    !(error instanceof Error)
    || !['ExportProjectBlockedError', 'ExportExecutionError'].includes(error.name)
    || !('safeDetails' in error)
  ) {
    return null
  }
  const details: unknown = error.safeDetails
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown>
    : null
}
