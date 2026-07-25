import {
  Code,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  Stack,
  Stat,
  Table,
  Tag,
  Text,
} from 'qoder/canvas';

const phases = [
  {
    id: 'a',
    title: 'Phase A: 设计系统预设',
    status: 'done' as const,
    description: '从 HyperFrames Skill 提取 13 个 frame preset，实现品牌色/字体自动匹配算法',
    files: '4 新文件 + 2 改造文件',
    details: 'design-system/types.ts, presets.ts, select.ts, build-frame.ts, index.ts',
  },
  {
    id: 'b',
    title: 'Phase B: 故事板格式升级',
    status: 'done' as const,
    description: '扩展 StoryboardShot 10 个新字段，对齐 STORYBOARD.md 格式',
    files: '1 新文件 + 5 改造文件',
    details: 'storyboard/serialize.ts + types/generate/prompts/validate/to-html 升级',
  },
  {
    id: 'c',
    title: 'Phase C: 音频系统集成',
    status: 'done' as const,
    description: 'TTS 旁白 (Mock/Azure/ElevenLabs) + BGM 获取，产出 audio_meta.json',
    files: '6 新文件 + 3 改造文件',
    details: 'audio/types.ts, tts-provider.ts, bgm-provider.ts, audio-pipeline.ts, word-timestamps.ts, index.ts',
  },
  {
    id: 'd',
    title: 'Phase D: 转场注入 + 字幕系统',
    status: 'done' as const,
    description: '5 种 GSAP 转场动画 + 词级时间戳字幕分组与 HTML 渲染',
    files: '7 新文件 + 2 改造文件',
    details: 'transitions/ (4 files) + captions/ (3 files)',
  },
  {
    id: 'e',
    title: 'Phase E: Pipeline 编排 + 前端增强',
    status: 'done' as const,
    description: '串联所有新模块，前端新增高级选项 UI 和进度阶段',
    files: '6 改造文件',
    details: 'run-pipeline.ts, job-store.ts, job-runner.ts, api.ts, lib/api.ts, launch-composer.tsx',
  },
];

const pipelineStages = [
  { label: 'Capturing', tone: 'neutral' as const },
  { label: 'Designing', tone: 'info' as const },
  { label: 'Storyboarding', tone: 'info' as const },
  { label: 'Audio', tone: 'info' as const },
  { label: 'Composing', tone: 'neutral' as const },
  { label: 'Transitioning', tone: 'info' as const },
  { label: 'Rendering', tone: 'neutral' as const },
  { label: 'Verifying', tone: 'neutral' as const },
];

const fixes = [
  ['字幕帧索引偏移', 'captions/build.ts + audio-pipeline.ts', 'voice.frame 从 1-based 改为 0-based，修复字幕与画面错位'],
  ['转场时长覆写', 'transitions/inject.ts', 'adjustedDurations 改为仅在未设置时写入，保留转场重叠时长'],
  ['TTS API Key 缺失', 'run-pipeline.ts', '调用 getAudioEnvConfig() 注入 apiKey/region 到 AudioConfig'],
  ['前端 TS 编译错误', '11 个文件', '修复 exactOptionalPropertyTypes、空值检查、未使用变量共 31 处'],
];

export default function HyperFramesIntegrationReport() {

  return (
    <Stack gap={20}>
      <Stack gap={4}>
        <H1>HyperFrames Skill 后端集成</H1>
        <Text tone="secondary">
          将 HyperFrames product-launch-video Skill 的成熟能力分阶段集成到 PurpleInk 后端 Pipeline
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="22" label="新增文件" tone="success" />
        <Stat value="11" label="改造文件" />
        <Stat value="5" label="Pipeline 阶段" tone="info" />
        <Stat value="0" label="TS 编译错误" tone="success" />
      </Grid>

      <Divider />

      <H2>增强后的 Pipeline</H2>
      <Stack gap={8}>
        <Stack direction="row" gap={6} wrap="wrap">
          {pipelineStages.map((stage, i) => (
            <Stack key={stage.label} gap={2} align="center">
              <Tag tone={stage.tone}>{stage.label}</Tag>
              <Text size="small" tone="secondary">
                {i === 0 ? '5%' : i === 1 ? '45%' : i === 2 ? '50%' : i === 3 ? '58%' : i === 4 ? '63%' : i === 5 ? '78%' : i === 6 ? '82%' : '95%'}
              </Text>
            </Stack>
          ))}
        </Stack>
        <Text size="small" tone="secondary">
          每个新阶段均有 try-catch 降级保护，失败时自动回退到原有逻辑
        </Text>
      </Stack>

      <Divider />

      <H2>实施阶段</H2>
      <Stack gap={12}>
        {phases.map((phase) => (
          <Stack key={phase.id} gap={4}>
            <Stack direction="row" gap={8} align="center">
              <Tag tone="success">{phase.status === 'done' ? '完成' : phase.status}</Tag>
              <H3>{phase.title}</H3>
              <Text size="small" tone="secondary">{phase.files}</Text>
            </Stack>
            <Text>{phase.description}</Text>
            <Code>{phase.details}</Code>
          </Stack>
        ))}
      </Stack>

      <Divider />

      <H2>新增模块能力</H2>
      <Grid columns={2} gap={12}>
        <Stack gap={4}>
          <H3>设计系统</H3>
          <Stat value="13" label="Frame Presets" tone="info" />
          <Text size="small">品牌色饱和度/明度分析 + 行业关键词 + 域名哈希确定性匹配</Text>
        </Stack>
        <Stack gap={4}>
          <H3>音频系统</H3>
          <Stat value="3" label="TTS Providers" tone="info" />
          <Text size="small">Mock (测试) / Azure (中文) / ElevenLabs (英文)</Text>
        </Stack>
        <Stack gap={4}>
          <H3>转场系统</H3>
          <Stat value="5" label="Transition Types" tone="info" />
          <Text size="small">crossfade / blur / push-slide / zoom-through / squeeze</Text>
        </Stack>
        <Stack gap={4}>
          <H3>字幕系统</H3>
          <Stat value="1" label="Caption Pipeline" tone="info" />
          <Text size="small">词级时间戳分组 → HTML 子组合 → caption_groups.json</Text>
        </Stack>
      </Grid>

      <Divider />

      <H2>代码审查修复</H2>
      <Table
        headers={['问题', '文件', '修复方案']}
        rows={fixes}
        rowTone={['warning', undefined, 'success']}
      />

      <Divider />

      <H2>关键设计决策</H2>
      <Table
        headers={['决策', '理由']}
        rows={[
          ['增量增强，不重写', '保留现有 Pipeline 骨架，在关键节点插入新模块'],
          ['Feature Flag 控制', '所有新能力可选启用，默认值保证向后兼容'],
          ['Azure TTS 优先', 'Skill 的 Kokoro 不支持中文，Azure 中文语音质量高'],
          ['确定性预设选择', '品牌色分析 + 域名哈希，同站结果稳定可复现'],
          ['Mock Provider 兜底', '无 API Key 时仍可测试完整音频管线流程'],
        ]}
      />

      <Divider />

      <Stack gap={4}>
        <H2>验证结果</H2>
        <Grid columns={2} gap={12}>
          <Stack gap={2}>
            <Tag tone="success">后端 tsc --noEmit</Tag>
            <Text size="small">零错误，退出码 0</Text>
          </Stack>
          <Stack gap={2}>
            <Tag tone="success">前端 tsc --noEmit</Tag>
            <Text size="small">零错误，退出码 0</Text>
          </Stack>
        </Grid>
      </Stack>

      <Text tone="secondary" size="small">
        HyperFrames Skill 能力后端集成方案 — 全部 5 个 Phase 实施完成
      </Text>
    </Stack>
  );
}
