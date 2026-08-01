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
})
