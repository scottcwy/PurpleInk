import type { DirectorPlan, ScriptUnit, ScriptVideoInput } from '../contracts'

export function buildDirectPrompt(input: ScriptVideoInput): { system: string; user: string } {
  return {
    system:
      '你是 script-first code video 的 DIRECT 导演。只返回 JSON，不输出 Markdown。不得新增文稿之外的事实。',
    user: [
      '阶段：DIRECT。请为下面的文稿建立全片 masterPlan 和 styleBible。',
      '要求：一镜一个核心判断；视觉必须服务来源事实；不把原稿逐句变成卡片；不得新增数字、客户、功能或结果。',
      `标题：${input.title}`,
      `视觉风格：${input.visualStyle}`,
      `文稿单元：${JSON.stringify(input.units)}`,
      '只返回 {"masterPlan":"...","styleBible":"..."}。',
    ].join('\n'),
  }
}

export function buildShotSpecPrompt(
  input: ScriptVideoInput,
  director: DirectorPlan,
  unit: ScriptUnit,
  expectedId: string,
): { system: string; user: string } {
  return {
    system:
      '你是 script-first code video 的 SHOT-SPEC 导演。只返回 JSON。不得新增事实，facts 必须逐字摘自来源单元。',
    user: [
      `阶段：SHOT-SPEC。目标镜头：${expectedId}。`,
      '只为当前来源单元规划一镜，sourceUnitId 必须保持不变，id 必须保持目标镜头 ID。',
      'facts 数组只能包含来源原文中连续出现的短语；visualDescription 只描述构图、运动和代码表现，不写新的产品事实。',
      `全片导演总纲：${JSON.stringify(director)}`,
      `当前来源单元：${JSON.stringify(unit)}`,
      `完整输入摘要：${JSON.stringify({ title: input.title, language: input.language })}`,
      '返回字段：id、sourceUnitId、purpose、visualIntent、composition、visualDescription、facts、onScreenText、durationSec。',
    ].join('\n'),
  }
}
