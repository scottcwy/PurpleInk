/**
 * 产物 kind 到 HTTP content-type 的映射。
 *
 * 单独成叶子模块（零依赖）而不是留在 `service.ts`：那边是 `server-only` 的
 * 数据访问层，任何想要这份纯映射的模块（如下载文件名推导）都会被迫把数据库
 * 依赖一起拖进来。与 `preview-mode.ts` 的 client-safe 定位保持一致。
 */
export function artifactContentType(kind: string): string {
  if (kind.endsWith('mp4')) return 'video/mp4'
  if (kind.startsWith('narration-audio')) return 'audio/mpeg'
  if (kind === 'director-fabricate') return 'text/html; charset=utf-8'
  if (kind === 'frame-thumbnail') return 'image/png'
  if (
    kind.includes('json') ||
    kind === 'director-shot-spec' ||
    kind === 'subtitle-track' ||
    kind === 'qa-vision-report'
  ) {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}
