/**
 * ShotType → HyperFrames Blueprint 映射表
 * 为每种镜头类型指定推荐的 blueprint 和 motion rules
 */

export interface BlueprintMapping {
  shotType: string;
  blueprintId: string;
  motionRules: string[];
  signatureMove: string;
}

export const BLUEPRINT_MAPPINGS: BlueprintMapping[] = [
  { shotType: 'brand-center', blueprintId: 'logo-assemble-lockup', motionRules: ['spring-pop-entrance', 'ambient-glow-bloom'], signatureMove: '品牌标识从中心凝聚成型' },
  { shotType: 'brand-side', blueprintId: 'ticker-takeover', motionRules: ['kinetic-beat-slam', 'gradient-text-sweep'], signatureMove: '循环词被英雄元素暴力取代' },
  { shotType: 'hero-split', blueprintId: 'cursor-ui-demo', motionRules: ['center-outward-expansion', 'anchored-layout-expand'], signatureMove: '光标驱动 UI 重构展示' },
  { shotType: 'hero-stack', blueprintId: 'kinetic-type-beats', motionRules: ['kinetic-beat-slam', 'discrete-text-sequence'], signatureMove: '文字即动效，token 原地切换' },
  { shotType: 'shot-window', blueprintId: 'device-surface-showcase', motionRules: ['multi-phase-camera', 'depth-of-field-blur'], signatureMove: '设备 mockup 展示产品流程' },
  { shotType: 'shot-tilt', blueprintId: 'camera-journey', motionRules: ['3d-camera-flight', 'depth-of-field-blur'], signatureMove: '摄像机多段连续飞行' },
  { shotType: 'shot-zoom', blueprintId: 'coordinate-target-zoom', motionRules: ['coordinate-target-zoom', 'depth-of-field-blur'], signatureMove: '缩放到非中心目标元素' },
  { shotType: 'feature-row', blueprintId: 'grid-card-assemble', motionRules: ['depth-scatter-assemble', 'spring-pop-entrance'], signatureMove: 'N 元素 3D 散布后自组装成网格' },
  { shotType: 'feature-stack', blueprintId: 'grid-card-assemble', motionRules: ['anchored-layout-expand', 'spring-pop-entrance'], signatureMove: '边缘固定容器增长展开' },
  { shotType: 'data-counter', blueprintId: 'dataviz-countup', motionRules: ['counting-dynamic-scale', 'stat-bars-and-fills'], signatureMove: '数字计数器 + 数据可视化填充' },
  { shotType: 'chips-marquee', blueprintId: 'fixed-anchor-cycle', motionRules: ['discrete-text-sequence', 'vertical-spring-ticker'], signatureMove: '固定锚点 + 循环切换内容' },
  { shotType: 'logo-wall', blueprintId: 'constellation-hub', motionRules: ['center-outward-expansion', 'avatar-cloud-network'], signatureMove: '节点环绕中心弹入形成星座' },
  { shotType: 'pricing', blueprintId: 'comparison-split', motionRules: ['split-tilt-cards', 'spring-pop-entrance'], signatureMove: '两卡片 opposing rotationY 倾斜' },
  { shotType: 'cta-push', blueprintId: 'cta-morph-press', motionRules: ['spring-pop-entrance', 'ambient-glow-bloom'], signatureMove: '品牌标记凝聚为 CTA 按钮' },
  { shotType: 'cta-fullbleed', blueprintId: 'titlecard-reveal', motionRules: ['kinetic-beat-slam', 'gradient-text-sweep'], signatureMove: '安静着陆节拍 + 渐变文字' },
  { shotType: 'data-chart', blueprintId: 'dataviz-countup', motionRules: ['stat-bars-and-fills', 'counting-dynamic-scale'], signatureMove: '数据图表 + 统计条动态填充' },
  { shotType: 'terminal-demo', blueprintId: 'cursor-ui-demo', motionRules: ['discrete-text-sequence', 'multi-phase-camera'], signatureMove: '终端命令行逐行输出展示' },
  { shotType: 'typing-effect', blueprintId: 'typewriter-reveal', motionRules: ['discrete-text-sequence'], signatureMove: '打字机逐字揭示效果' },
  { shotType: 'scroll-demo', blueprintId: 'device-surface-showcase', motionRules: ['multi-phase-camera', 'depth-scatter-assemble'], signatureMove: '设备表面滚动展示' },
  { shotType: 'video-shot', blueprintId: 'camera-journey', motionRules: ['multi-phase-camera', 'ambient-glow-bloom'], signatureMove: '视频镜头 + 光晕绽放' },
  { shotType: 'shot-split', blueprintId: 'comparison-split', motionRules: ['center-outward-expansion', 'spring-pop-entrance'], signatureMove: '对比分屏从中心展开' },
];

export function getBlueprintMapping(shotType: string): BlueprintMapping | undefined {
  return BLUEPRINT_MAPPINGS.find(m => m.shotType === shotType);
}

export function getAllBlueprintIds(): string[] {
  return [...new Set(BLUEPRINT_MAPPINGS.map(m => m.blueprintId))];
}

export function getAllMotionRuleIds(): string[] {
  return [...new Set(BLUEPRINT_MAPPINGS.flatMap(m => m.motionRules))];
}
