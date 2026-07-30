import { artifactContentType } from './content-type'

/**
 * 产物下载的文件名与 Content-Disposition。
 *
 * 文件名刻意由 kind + content hash 前缀推导，而不是项目标题：
 * - 标题是用户输入，进 HTTP 头需要 RFC 5987 编码加字符净化，多一层注入面；
 * - 哈希前缀与页面上展示的 `sha256:8d21…` 是同一串，用户下完文件就能对上，
 *   这比一个好看的名字更符合「UI 可见字段必须可追溯」。
 * 结果恒为 ASCII，因此不需要 filename* 兜底。
 */

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'image/png': 'png',
  'text/html': 'html',
  'application/json': 'json',
}

export function artifactDownloadFilename(input: {
  kind: string
  contentHash: string | null
}): string {
  const contentType = artifactContentType(input.kind).split(';')[0] ?? ''
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'bin'
  const stem = asciiSlug(input.kind) || 'artifact'
  const digest = (input.contentHash ?? '').slice(0, 12).toLowerCase()
  return /^[0-9a-f]{12}$/.test(digest)
    ? `${stem}-${digest}.${extension}`
    : `${stem}.${extension}`
}

/** 只保留 ASCII 字母数字与连字符，其余折叠为单个连字符。 */
function asciiSlug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

/** `?download` 是否要求以附件形式下载。缺参数保持内联，既有预览调用方不受影响。 */
export function wantsAttachment(value: string | null): boolean {
  return value === '1' || value === 'true'
}

export function attachmentDisposition(filename: string): string {
  return `attachment; filename="${filename}"`
}
