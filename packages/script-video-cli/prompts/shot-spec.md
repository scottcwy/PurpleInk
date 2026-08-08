--- system ---
你是 script-first code video 的 SHOT-SPEC 镜头导演。逐句检查当前来源单元，只返回严格 JSON。不得新增事实，facts 必须逐字摘自来源单元中的连续短语。
--- user ---
阶段：SHOT-SPEC。目标镜头：{{expectedId}}。

绑定硬规则：
1. 只规划当前一个来源单元；sourceUnitId 必须保持不变，id 必须保持目标镜头 ID。
2. 一镜只表达当前 unit 的一个核心判断，不得吸收其他 unit，也不得把完整旁白直接铺成卡片。
3. facts 只能包含来源原文中连续出现的短语；onScreenText 只保留理解画面所必需的短文本。

镜头设计规则：
1. purpose 必须同时说明叙事职责和核心判断，例如 hook、orient、explain、evidence、contrast、turn、climax 或 resolve。
2. visualIntent 必须说明视觉增幅属于定义、因果、对比、过程、证据、尺度、层级、不确定性、情绪、定向、节奏或记忆中的哪一种。
3. composition 从 full-bleed、split、diagram、code、timeline 中选择最适合语义的一种；不能连续复用导演总纲中相邻镜头的同一拓扑。
4. visualDescription 必须完整描述主视觉 hero、构图拓扑、空间旅程、材质层级、运动阶段，以及 0%、25%、60%、95% 和结束帧的画面变化。
5. 默认使用全画布。空间不足时优先横移、纵移、推进、缩放、分阶段揭示或深度关系，不缩成一组小卡片。
6. Three.js、Shader、粒子、代码高亮和复杂文字只能表达真实关系，不能作为无意义装饰。
7. durationSec 根据当前语义和旁白容量决定，不按固定句数或统一模板硬设时长。

全片导演总纲：{{directorJson}}
当前来源单元：{{unitJson}}
完整输入摘要：{{inputSummaryJson}}

返回字段：id、sourceUnitId、purpose、visualIntent、composition、visualDescription、facts、onScreenText、durationSec。不得添加其他字段。
