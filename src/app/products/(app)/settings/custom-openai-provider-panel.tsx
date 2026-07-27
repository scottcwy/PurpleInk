'use client'

import { KeyRound } from 'lucide-react'
import { SettingsPanel } from '@/components/ui/settings-panel'
import { Toast } from '@/components/ui/toast'
import { CustomOpenAiAsrSection } from './custom-openai-asr-section'
import { CustomOpenAiTtsSection } from './custom-openai-tts-section'
import { OpenAiCompatibleEndpointSection } from './openai-compatible-endpoint-section'
import {
  countConfiguredCustomEndpoints,
  CUSTOM_ENDPOINT_COUNT,
} from './custom-openai-status'
import type { ReadyModelSettingsController } from './model-service-contract'

/**
 * 自定义 OpenAI 兼容服务面板。
 *
 * 供应商网格里只有一张「自定义兼容模型」卡片，展开后按顺序排三个**独立**接入点：
 * 文本与视觉、TTS、ASR。三者各有自己的端点、模型、凭据与校验，一次保存只动一份。
 */
export function CustomOpenAiProviderPanel({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  const configuredCount = countConfiguredCustomEndpoints(controller.data)
  return (
    <SettingsPanel
      id="provider-openai-compatible"
      title="OpenAI 兼容模型服务"
      description="三个互相独立的接入点：文本与视觉、TTS、ASR。各自的端点、模型与密钥分开保存与校验。"
      icon={KeyRound}
      summary={`${configuredCount} / ${CUSTOM_ENDPOINT_COUNT} 已配置`}
    >
      <OpenAiCompatibleEndpointSection
        title="文本与视觉"
        description="用于脚本、分镜、代码生成与分镜验收"
        configured={controller.data.customOpenAi?.configured === true}
        busy={controller.busy === 'custom-openai'}
        keyLabel="OpenAI 兼容"
        saveHint="保存时分别校验文本模型与视觉模型"
        fields={[
          {
            label: 'OpenAI 兼容端点',
            value: controller.customOpenAiDraft.baseUrl,
            placeholder: 'https://example.com/v1',
            onChange: (value) => controller.setCustomOpenAiField('baseUrl', value),
          },
          {
            label: '默认模型',
            value: controller.customOpenAiDraft.textModel,
            placeholder: '文本模型 ID',
            onChange: (value) => controller.setCustomOpenAiField('textModel', value),
          },
          {
            label: '视觉模型',
            value: controller.customOpenAiDraft.visionModel,
            placeholder: '留空则本端点不承担视觉路由',
            onChange: (value) => controller.setCustomOpenAiField('visionModel', value),
          },
        ]}
        extra={
          /*
            常驻说明而非可关闭通知：这是会导致运行期失败的配置约束。用 warning 而不是
            info，因为填错会让分镜验收在 FINALIZE 阶段才失败。Toast 自带 TriangleAlert
            图标，状态不只靠色相表达。
          */
          <div className="px-3 pb-2">
            <Toast
              variant="warning"
              title="视觉模型需要真的支持图像输入"
              body="保存时会用一张 8×8 探针图片单独校验该模型；纯文本模型会被拒绝。留空则分镜验收不能路由到本端点。"
              className="w-full"
            />
          </div>
        }
        onSave={async (apiKey) => {
          const result = await controller.submit({
            customOpenAi: { apiKey, ...controller.customOpenAiDraft },
          }, 'custom-openai')
          return result.ok
        }}
      />
      <CustomOpenAiTtsSection controller={controller} />
      <CustomOpenAiAsrSection controller={controller} />
    </SettingsPanel>
  )
}
