export type CommunityFilm = {
  slug: string
  title: string
  category: string
  description: string
  duration: string
  videoSrc: string
  posterSrc: string
  orientation: 'landscape' | 'portrait'
  placement: 'featured' | 'portrait' | 'standard'
}

export const communityFilms: readonly CommunityFilm[] = [
  {
    slug: 'ai-coding-workflow',
    title: 'Qoder：设计稿到代码',
    category: 'AI CODING',
    description: 'Qoder 将设计上下文、代码规则与生成过程组织成可见工作流。',
    duration: '00:40',
    videoSrc: '/videos/community/ai-coding-workflow.mp4',
    posterSrc: '/img/community/ai-coding-workflow.webp',
    orientation: 'landscape',
    placement: 'featured',
  },
  {
    slug: 'red-skill-launch',
    title: '小红书 RED Skill 全量上线',
    category: 'RED SKILL',
    description: '小红书 RED Skill 的竖屏功能发布短片，呈现挂载与获取流程。',
    duration: '00:58',
    videoSrc: '/videos/community/red-skill-launch.mp4',
    posterSrc: '/img/community/red-skill-launch.webp',
    orientation: 'portrait',
    placement: 'portrait',
  },
  {
    slug: 'vision-model-intro',
    title: '阶跃星辰：再向上',
    category: 'MODEL STORY',
    description: '阶跃星辰以结构化视觉语言介绍模型能力与演进方向。',
    duration: '00:47',
    videoSrc: '/videos/community/vision-model-intro.mp4',
    posterSrc: '/img/community/vision-model-intro.webp',
    orientation: 'landscape',
    placement: 'standard',
  },
  {
    slug: 'superun-product-discovery',
    title: 'Superrun：用对话发现产品',
    category: 'PRODUCT DISCOVERY',
    description: 'Superrun 从真实产品页面出发，展示对话式产品发现体验。',
    duration: '00:55',
    videoSrc: '/videos/community/superun-product-discovery.mp4',
    posterSrc: '/img/community/superun-product-discovery.webp',
    orientation: 'landscape',
    placement: 'standard',
  },
]
