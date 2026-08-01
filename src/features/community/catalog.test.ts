import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { communityFilms } from './catalog'

describe('community film catalog', () => {
  it('features four real static films in the expected order', () => {
    expect(communityFilms.map((film) => film.slug)).toEqual([
      'ai-coding-workflow',
      'red-skill-launch',
      'vision-model-intro',
      'superun-product-discovery',
    ])

    expect(communityFilms.map((film) => film.title)).toEqual([
      'Qoder：设计稿到代码',
      '小红书 RED Skill 全量上线',
      '阶跃星辰：再向上',
      'Superrun：用对话发现产品',
    ])
    expect(communityFilms[0]?.placement).toBe('featured')
    expect(communityFilms[2]?.placement).toBe('standard')
  })

  it('uses unique slugs and scoped public media paths', () => {
    const slugs = communityFilms.map((film) => film.slug)

    expect(new Set(slugs).size).toBe(slugs.length)
    for (const film of communityFilms) {
      expect(film.posterSrc).toMatch(
        /^\/img\/community\/[a-z0-9-]+\.webp$/,
      )
      expect(film.videoSrc).toMatch(
        /^\/videos\/community\/[a-z0-9-]+\.mp4$/,
      )
    }
  })

  it('references non-empty public media files', () => {
    for (const film of communityFilms) {
      for (const mediaPath of [film.posterSrc, film.videoSrc]) {
        const publicFile = resolve(process.cwd(), 'public', mediaPath.slice(1))
        expect(statSync(publicFile).size, mediaPath).toBeGreaterThan(0)
      }
    }
  })
})
