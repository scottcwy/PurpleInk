/**
 * ASSEMBLE 阶段（score/shot-sfx）只需基调参考，不需要完整样式圣经：
 * 取首个非空段落并限制在约 1000 字符内。
 * 按 code point 截断避免切断代理对；全空段时回退整个 styleBible，
 * 确保结果非空，不破坏下游 prompt schema 的 min(1) 校验。
 */
export function styleBibleToneExcerpt(styleBible: string): string {
  const firstParagraph = styleBible
    .split(/\n\s*\n/)
    .find((paragraph) => paragraph.trim().length > 0)
  const excerpt = truncateByCodePoint(firstParagraph ?? styleBible, 1000)
  return excerpt.length > 0 ? excerpt : truncateByCodePoint(styleBible, 1000)
}

function truncateByCodePoint(text: string, maxCodePoints: number): string {
  return Array.from(text).slice(0, maxCodePoints).join('')
}
