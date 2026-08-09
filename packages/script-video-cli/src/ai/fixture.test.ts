import { describe, expect, it } from 'vitest'

import { createFixtureAiClient } from './fixture'

describe('fixture AI client', () => {
  it('exposes the same real timeline contract required from generated shots', async () => {
    const html = await createFixtureAiClient().completeText({
      system: 'fixture',
      user: '目标镜头：S001\n来源单元：{"text":"可见事实"}',
    })

    expect(html).toContain('timeline:fixtureTimeline')
    expect(html).toContain('gsap.timeline({paused:true})')
  })
})
