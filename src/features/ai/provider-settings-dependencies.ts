import 'server-only'
import { getAiConfigDependencies } from './config'
import type { AudioProfileDependencies } from './openai-compatible-audio-config'
import type { OpenAiCompatibleDependencies } from './openai-compatible-config'

/**
 * 从 DI 根取出各自定义端点配置模块所需的依赖。
 *
 * 这两个 store 在 `AiConfigDependencies` 里是可选的（测试可以只注入用得到的部分），
 * 所以取用点必须显式失败而不是让 `undefined` 往下流——缺存储时报「存储不可用」
 * 比在下游某处炸出 `Cannot read properties of undefined` 可诊断得多。
 */
export function audioDependencies(): AudioProfileDependencies {
  const dependencies = getAiConfigDependencies()
  if (!dependencies.openAiCompatibleAudioProfiles) {
    throw new Error('自定义兼容音频端点配置存储不可用')
  }
  return {
    credentials: dependencies.credentials,
    profileStore: dependencies.openAiCompatibleAudioProfiles,
  }
}

export function customOpenAiDependencies(): OpenAiCompatibleDependencies {
  const dependencies = getAiConfigDependencies()
  if (!dependencies.openAiCompatibleProfiles) {
    throw new Error('OpenAI 兼容模型配置存储不可用')
  }
  return {
    credentials: dependencies.credentials,
    profileStore: dependencies.openAiCompatibleProfiles,
  }
}
