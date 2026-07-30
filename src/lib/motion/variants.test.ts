import { describe, expect, it } from 'vitest'
import {
  SPRING_SPATIAL_DEFAULT,
  TRANSITION_BASE,
  TRANSITION_EXIT,
} from './tokens'
import { collapse } from './variants'

describe('motion variants', () => {
  it('separates spatial spring from opacity tween in collapse states', () => {
    expect(collapse.visible).toMatchObject({
      transition: {
        default: SPRING_SPATIAL_DEFAULT,
        opacity: TRANSITION_BASE,
      },
    })
    expect(collapse.hidden).toMatchObject({
      transition: {
        default: SPRING_SPATIAL_DEFAULT,
        opacity: TRANSITION_EXIT,
      },
    })
  })
})
