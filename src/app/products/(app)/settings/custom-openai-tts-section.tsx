'use client'

import { SegmentedControl } from '@/components/ui/segmented-control'
import { SettingsRow } from '@/components/ui/settings-row'
import { OpenAiCompatibleEndpointSection } from './openai-compatible-endpoint-section'
import type { ReadyModelSettingsController } from './model-service-contract'

const AUDIO_FORMAT_OPTIONS = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
]

/**
 * 自定义兼容 TTS 接入点。
 *
 * 音色必填且不给默认值：音色表由端点决定，无法推断。音频格式只开放 MP3 / WAV——
 * 旁白时长由本地解码真实字节实测，而解码只识别 MP3 帧头与 WAV fmt chunk。
 */
export function CustomOpenAiTtsSection({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  const draft = controller.customOpenAiTtsDraft
  return (
    <OpenAiCompatibleEndpointSection
      title="TTS（旁白合成）"
      description="POST /audio/speech"
      configured={controller.data.customOpenAiTts?.configured === true}
      busy={controller.busy === 'custom-openai-tts'}
      keyLabel="自定义兼容 TTS"
      saveHint="保存时会发起一次极短真实合成"
      fields={[
        {
          label: 'OpenAI 兼容端点',
          value: draft.baseUrl,
          placeholder: 'https://example.com/v1',
          onChange: (value) => controller.setCustomOpenAiTtsField('baseUrl', value),
        },
        {
          label: 'TTS 模型 ID',
          value: draft.model,
          placeholder: '例如 tts-1',
          onChange: (value) => controller.setCustomOpenAiTtsField('model', value),
        },
        {
          label: '音色',
          value: draft.voice,
          placeholder: '端点支持的音色 ID',
          onChange: (value) => controller.setCustomOpenAiTtsField('voice', value),
          note: '音色由端点决定，没有内置默认值；填错会在保存校验时被拒绝。',
        },
      ]}
      extra={
        <SettingsRow
          label="音频格式"
          className="h-auto min-h-11 flex-col items-stretch gap-1 py-2 sm:flex-row sm:items-center"
        >
          <div className="flex min-w-0 flex-1 flex-col items-end gap-1">
            <SegmentedControl
              options={AUDIO_FORMAT_OPTIONS}
              value={draft.audioFormat}
              onChange={(value) =>
                controller.setCustomOpenAiTtsField(
                  'audioFormat',
                  value === 'wav' ? 'wav' : 'mp3',
                )}
              className="max-w-full"
            />
            <span className="text-[11px] leading-4 text-ds-text-muted">
              只开放 MP3 与 WAV：旁白时长由本地解码真实字节实测，其他容器无法读取。
            </span>
          </div>
        </SettingsRow>
      }
      onSave={async (apiKey) => {
        const result = await controller.submit({
          customOpenAiTts: { apiKey, ...draft },
        }, 'custom-openai-tts')
        return result.ok
      }}
    />
  )
}
