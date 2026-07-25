// 对外错误文案：只保留 message，不外泄 stack / 本机绝对路径（细节走 logger）。
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
