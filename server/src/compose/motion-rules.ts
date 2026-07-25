/**
 * Motion Rules 库 — 10 条核心 GSAP 代码生成函数
 * 每条函数返回 GSAP timeline 代码字符串，全部 seek-safe。
 *
 * 约束：
 * - 所有函数使用 fromTo() 而非 from() 或 to()
 * - 使用绝对值而非相对值（不用 +=）
 * - 禁止 Math.random()（用确定性伪随机如 Math.sin(i * 137.5)）
 * - 禁止 repeat: -1 或 yoyo: true
 * - 只动画 transform 和 opacity
 */

/**
 * 1. springPopEntrance — 弹性弹入入场
 * 元素从缩小+下移+透明 → 正常状态
 */
export function springPopEntrance(sel: string, delay: number = 0): string {
  return `      tl.fromTo("${sel}", { opacity: 0, scale: 0.8, y: 30 }, { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${delay});`;
}

/**
 * 2. kineticBeatSlam — 动能节拍重击
 * 每个 word 用不同方式入场：rotationX 翻转 + 下落
 */
export function kineticBeatSlam(wordSelectors: string[], baseTime: number, stagger: number = 0.1): string[] {
  return wordSelectors.map((wordSel, i) => {
    const t = baseTime + i * stagger;
    return `      tl.fromTo("${wordSel}", { opacity: 0, y: 40, rotationX: -90 }, { opacity: 1, y: 0, rotationX: 0, duration: 0.3, ease: "power3.out" }, ${t});`;
  });
}

/**
 * 3. discreteTextSequence — 离散文本序列
 * 按时间阈值替换文本状态（通过 data 属性）
 */
export function discreteTextSequence(sel: string, states: string[], timestamps: number[]): string[] {
  return states.map((state, i) => {
    return `      tl.set("${sel}", { attr: { 'data-text': ${JSON.stringify(state)} } }, ${timestamps[i]});`;
  });
}

/**
 * 4. countingDynamicScale — 计数动态缩放
 * 数字从 from 到 to 增长，scale 随之变化
 */
export function countingDynamicScale(sel: string, delay: number = 0): string {
  return `      tl.fromTo("${sel}", { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" }, ${delay});`;
}

/**
 * 5. statBarsAndFills — 统计条填充
 * 进度条从 0 填充到目标值（使用 scaleX）
 */
export function statBarsAndFills(barSelectors: string[], values: number[], startDelay: number = 0): string[] {
  return values.map((val, i) => {
    const delay = startDelay + i * 0.15;
    return `      tl.fromTo("${barSelectors[i]}", { scaleX: 0 }, { scaleX: ${val}, duration: 0.8, ease: "power3.out" }, ${delay});`;
  });
}

/**
 * 6. depthScatterAssemble — 3D 散布组装
 * 元素从确定性伪随机 3D 位置聚合到原位
 */
export function depthScatterAssemble(itemSelectors: string[], startDelay: number = 0): string[] {
  return itemSelectors.map((itemSel, i) => {
    const rx = Math.sin(i * 137.5) * 200;
    const ry = Math.cos(i * 137.5) * 200;
    const rz = Math.sin(i * 73.1) * 100;
    const delay = startDelay + i * 0.08;
    return `      tl.fromTo("${itemSel}", { opacity: 0, x: ${round(rx)}, y: ${round(ry)}, z: ${round(rz)}, rotationY: 180 }, { opacity: 1, x: 0, y: 0, z: 0, rotationY: 0, duration: 0.8, ease: "power3.out" }, ${delay});`;
  });
}

/**
 * 7. centerOutwardExpansion — 中心向外扩展
 * 元素从中心向外辐射展开
 */
export function centerOutwardExpansion(selectors: string[], startDelay: number = 0): string[] {
  return selectors.map((sel, i) => {
    const angle = (i / selectors.length) * Math.PI * 2;
    const dist = 100;
    const fromX = round(Math.cos(angle) * dist);
    const fromY = round(Math.sin(angle) * dist);
    const delay = startDelay + i * 0.1;
    return `      tl.fromTo("${sel}", { opacity: 0, x: ${fromX}, y: ${fromY} }, { opacity: 1, x: 0, y: 0, duration: 0.7, ease: "power3.out" }, ${delay});`;
  });
}

/**
 * 8. multiPhaseCamera — 多阶段相机运动
 * 拉回 → 聚焦 → 推进（使用 transform scale/translate）
 */
export function multiPhaseCamera(worldSel: string, startDelay: number = 0): string[] {
  return [
    `      tl.fromTo("${worldSel}", { scale: 1, x: 0, y: 0 }, { scale: 0.8, x: 0, y: 0, duration: 1.5, ease: "power3.inOut" }, ${startDelay});`,
    `      tl.to("${worldSel}", { scale: 1.2, x: -50, y: -30, duration: 1.5, ease: "power3.inOut" }, ${startDelay + 1.5});`,
    `      tl.to("${worldSel}", { scale: 1.0, x: 0, y: 0, duration: 1.0, ease: "power3.inOut" }, ${startDelay + 3.0});`,
  ];
}

/**
 * 9. ambientGlowBloom — 径向光晕绽放
 * 光晕从中心绽放然后回落
 */
export function ambientGlowBloom(sel: string, startDelay: number = 0): string[] {
  return [
    `      tl.fromTo("${sel}", { opacity: 0, scale: 0.5 }, { opacity: 0.6, scale: 1.5, duration: 2.0, ease: "power3.out" }, ${startDelay});`,
    `      tl.to("${sel}", { opacity: 0.3, duration: 1.0, ease: "power3.in" }, ${startDelay + 2.0});`,
  ];
}

/**
 * 10. gradientTextSweep — 渐变文字扫过
 * 渐变背景从左扫到右
 */
export function gradientTextSweep(sel: string, startDelay: number = 0): string {
  return `      tl.fromTo("${sel}", { backgroundPosition: '200% 0' }, { backgroundPosition: '0% 0', duration: 1.2, ease: 'power3.out' }, ${startDelay});`;
}

/** 辅助：四舍五入到两位小数 */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
