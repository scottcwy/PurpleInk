import type { AiClient, AiCompletionInput } from './openai-compatible'

export function createFixtureAiClient(): AiClient {
  return {
    completeJson: async (input) => {
      if (input.user.includes('阶段：SEMANTIC_INGEST')) {
        const atoms = parseJsonAfter(input.user, '原文原子 JSON：') as Array<{ id: string }>
        const groupSize = Math.max(1, Math.ceil(atoms.length / 128))
        const units: Array<{ id: string; from: string; to: string; order: number }> = []
        for (let start = 0; start < atoms.length; start += groupSize) {
          const group = atoms.slice(start, start + groupSize)
          const index = units.length
          units.push({
            id: `U${String(index + 1).padStart(3, '0')}`,
            from: group[0]!.id,
            to: group[group.length - 1]!.id,
            order: index,
          })
        }
        return { units }
      }
      if (input.user.includes('阶段：DIRECT'))
        return { masterPlan: '按来源事实建立镜头节奏。', styleBible: '本地、确定性、无外部资源。' }
      const unit = parseJsonAfter(input.user, '当前来源单元：') as { id: string; text: string; visualIntent?: string }
      const shotId = input.user.match(/目标镜头：(S\d{3})/u)?.[1] ?? 'S001'
      return {
        id: shotId,
        sourceUnitId: unit.id,
        purpose: '将当前来源事实转为可观察画面。',
        visualIntent: unit.visualIntent ?? 'show',
        composition: 'split',
        visualDescription: '左侧原文事实，右侧用几何关系进行解释。',
        facts: [unit.text],
        onScreenText: [unit.text],
        durationSec: 7,
      }
    },
    completeText: async (input) => createFixtureHtml(input),
  }
}

function createFixtureHtml(input: AiCompletionInput): string {
  const shotId = input.user.match(/目标镜头：(S\d{3})/u)?.[1] ?? 'S001'
  const unit = parseJsonAfter(input.user, '来源单元：') as { text?: string }
  const text = escapeHtml(unit.text ?? 'script video')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b1020;color:#f5f7ff;font-family:Arial,sans-serif}
main{box-sizing:border-box;width:1920px;height:1080px;padding:140px;display:grid;place-items:center;background:linear-gradient(135deg,#0b1020,#1d2950)}
.card{max-width:1400px;padding:72px;border:2px solid #7dd3fc;border-radius:28px;background:#13203d;box-shadow:0 30px 90px #0008;font-size:56px;line-height:1.35}
</style></head><body><main id="shot-root" data-pi-seed="${shotId}"><div class="card">${text}</div></main><script>
const fixtureTimeline=gsap.timeline({paused:true});
fixtureTimeline.fromTo('.card',{x:-420,rotationY:-35,opacity:0},{x:0,rotationY:0,opacity:1,duration:2,ease:'power3.out'},0)
  .to('.card',{y:-40,scale:1.05,duration:2,ease:'sine.inOut'},2)
  .to('.card',{x:360,rotationY:28,opacity:.2,duration:3,ease:'power2.inOut'},4);
window.__PURPLEINK_RENDER__={ready:true,durationSec:7,timeline:fixtureTimeline,seek:function(progress){fixtureTimeline.progress(Math.max(0,Math.min(1,progress))).pause()}};
</script></body></html>`
}

function parseJsonAfter(text: string, label: string): unknown {
  const start = text.indexOf(label)
  if (start < 0) throw new Error('fixture prompt contract missing')
  const json = text.slice(start + label.length).split('\n')[0]
  return JSON.parse(json) as unknown
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}
