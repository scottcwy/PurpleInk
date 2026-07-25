'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { renderShotAndWait } from './shot-api'

/** 无代码时的占位文案，也用于判断是否需走“生成”入口。 */
export const NO_CODE = '分镜代码尚未生成'

/**
 * 分镜页运行时状态。outputUrl 以服务端查到的 render-mp4 初始化；
 * render() 成功后刷新服务端组件，回填新的代码、视频与合同字段。
 */
export function useShotRuntime(
  projectId: string,
  nodeId: string,
  previewUrl?: string,
  initialOutputUrl?: string,
) {
  const router = useRouter()
  const [rendering, setRendering] = useState(false)
  const [outputUrl, setOutputUrl] = useState<string | undefined>(initialOutputUrl)
  const [sourceCode, setSourceCode] = useState(previewUrl ? '' : NO_CODE)
  const [codeLoading, setCodeLoading] = useState(Boolean(previewUrl))
  const [codeError, setCodeError] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!previewUrl) return
    let active = true
    void fetch(previewUrl)
      .then((response) => {
        if (!response.ok) throw new Error('分镜代码读取失败')
        return response.text()
      })
      .then((text) => {
        if (!active) return
        setSourceCode(text)
        setCodeError(false)
      })
      .catch(() => {
        if (!active) return
        setCodeError(true)
        setSourceCode('分镜代码读取失败')
      })
      .finally(() => {
        if (active) setCodeLoading(false)
      })
    return () => {
      active = false
    }
  }, [previewUrl])

  async function render() {
    setRendering(true)
    setError(undefined)
    try {
      const result = await renderShotAndWait(projectId, nodeId)
      if (result.status === 'failed') {
        setError(result.error ?? '单镜渲染失败')
      } else {
        if (result.artifactUrl) setOutputUrl(result.artifactUrl)
        router.refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '单镜渲染失败')
    } finally {
      setRendering(false)
    }
  }

  return { rendering, outputUrl, sourceCode, codeLoading, codeError, error, render }
}
