'use client'

import { useRouter } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, LoaderCircle, RotateCcw } from 'lucide-react'
import {
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  LoginRequiredDialog,
  useRequireLogin,
} from '@/features/auth/login-required-dialog'
import { productCanvasHref } from '@/features/navigation/products-routes'
import {
  createProject,
  createProjectCreationKey,
  startProject,
} from '@/features/projects/project-create-client'
import {
  ActionCircle,
  ComposerSettings,
  friendlyError,
  normalizedHttpUrl,
  PILL_BASE,
  type Quality,
  type Stage,
} from './launch-composer-support'

const subscribeToHydration = () => () => {}

export function LaunchComposer(): ReactNode {
  const router = useRouter()
  const [stage, setStage] = useState<Stage>('idle')
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('')
  const [quality, setQuality] = useState<Quality>('standard')
  const [duration, setDuration] = useState(24)
  const [createdProjectId, setCreatedProjectId] = useState<string>()
  const prefersReducedMotion = useReducedMotion()
  const motionReady = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  )
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const creationKeyRef = useRef<string | undefined>(undefined)
  const {
    loginRequired,
    closeLoginDialog,
    ensureLoggedIn,
    handleAuthError,
  } = useRequireLogin()

  const reset = useCallback(() => {
    setStage('idle')
    setUrl('')
    setMessage('')
    setCreatedProjectId(undefined)
    creationKeyRef.current = undefined
  }, [])

  const openInput = useCallback(() => {
    setStage('input')
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const invalidateCreatedProject = useCallback(() => {
    setCreatedProjectId(undefined)
    creationKeyRef.current = undefined
    setMessage('')
  }, [])

  const run = useCallback(async () => {
    if (submittingRef.current) return
    const target = normalizedHttpUrl(url)
    if (!target) {
      setMessage('请输入以 http(s):// 开头的网址')
      inputRef.current?.focus()
      return
    }
    if (!(await ensureLoggedIn())) return

    submittingRef.current = true
    setStage('creating')
    setMessage('')
    let projectId = createdProjectId
    try {
      if (!projectId) {
        creationKeyRef.current ??= createProjectCreationKey()
        projectId = await createProject({
          kind: 'website',
          url: target,
          durationSec: duration,
          quality,
          visualTheme: 'dark',
        }, fetch, creationKeyRef.current)
        setCreatedProjectId(projectId)
      }
      await startProject(projectId)
      router.push(productCanvasHref(projectId))
    } catch (cause) {
      if (handleAuthError(cause)) {
        setMessage(projectId ? '项目已创建，登录后可重试启动' : '')
        setStage(projectId ? 'error' : 'input')
        return
      }
      setMessage(friendlyError(cause))
      setStage('error')
    } finally {
      submittingRef.current = false
    }
  }, [
    createdProjectId,
    duration,
    ensureLoggedIn,
    handleAuthError,
    quality,
    router,
    url,
  ])

  const reduceMotionAfterHydration = motionReady && prefersReducedMotion
  const interactive = reduceMotionAfterHydration
    ? {}
    : { whileHover: { y: -2 }, whileTap: { scale: 0.98, y: 1 } }
  const enter = reduceMotionAfterHydration
    ? { initial: false as const, animate: { opacity: 1, y: 0 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      }
  const accessory = reduceMotionAfterHydration
    ? { initial: false as const, animate: { opacity: 1, height: 'auto' as const } }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' as const },
        exit: { opacity: 0, height: 0 },
      }
  const spin = reduceMotionAfterHydration
    ? {}
    : {
        animate: { rotate: 360 },
        transition: { duration: 0.8, ease: 'linear' as const, repeat: Infinity },
      }

  return (
    <div className="flex w-full max-w-md flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {stage === 'idle' && (
          <motion.button
            key="idle"
            type="button"
            onClick={openInput}
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-base font-medium sm:w-auto sm:min-w-88`}
            {...interactive}
            {...enter}
          >
            <span className="relative z-10 whitespace-nowrap">
              创建你的首个 Launch Video
            </span>
            <ActionCircle>
              <ArrowRight className="h-5 w-5 transition-transform duration-fast group-hover:translate-x-0.5" />
            </ActionCircle>
          </motion.button>
        )}

        {stage === 'input' && (
          <motion.form
            key="input"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void run()
            }}
            className={`${PILL_BASE} py-2 pr-2 pl-6`}
            {...enter}
          >
            <input
              ref={inputRef}
              value={url}
              onChange={(event) => {
                invalidateCreatedProject()
                setUrl(event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') reset()
              }}
              type="url"
              inputMode="url"
              placeholder="粘贴产品网址，例如 https://ui.shadcn.com"
              className="no-focus-ring text-foreground placeholder:text-muted-foreground relative z-10 h-full min-w-0 flex-1 bg-transparent pr-3 text-base font-medium focus:outline-none"
              aria-label="产品网址"
              required
              aria-invalid={Boolean(message)}
              aria-describedby={message ? "product-url-error" : undefined}
            />
            <button type="submit" aria-label="创建网站视频项目" className="focus-ring rounded-full">
              <ActionCircle>
                <ArrowRight className="h-5 w-5" />
              </ActionCircle>
            </button>
          </motion.form>
        )}

        {stage === 'creating' && (
          <motion.div
            key="creating"
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-base font-medium`}
            {...enter}
            aria-live="polite"
          >
            <span className="relative z-10 whitespace-nowrap">
              {createdProjectId ? '正在启动项目工作流…' : '正在创建网站项目…'}
            </span>
            <ActionCircle active>
              <motion.span className="flex" {...spin}>
                <LoaderCircle className="h-5 w-5" />
              </motion.span>
            </ActionCircle>
          </motion.div>
        )}

        {stage === 'error' && (
          <motion.button
            key="error"
            type="button"
            onClick={createdProjectId ? () => void run() : openInput}
            className={`${PILL_BASE} justify-between py-2 pr-2 pl-7 text-sm font-medium`}
            {...interactive}
            {...enter}
          >
            <span className="text-muted-foreground relative z-10 line-clamp-2 pr-3 text-left">
              {message || '项目创建失败，点此重试'}
            </span>
            <ActionCircle>
              <RotateCcw className="h-5 w-5" />
            </ActionCircle>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {stage === 'input' && message && (
          <motion.p
            key="input-error"
            id="product-url-error"
            role="alert"
            className="text-red-700 px-2 pt-3 text-sm font-medium dark:text-red-300"
            {...accessory}
          >
            {message}
          </motion.p>
        )}
        {stage === 'input' && (
          <motion.div key="settings" className="overflow-hidden" {...accessory}>
            <ComposerSettings
              quality={quality}
              duration={duration}
              onQualityChange={(value) => {
                invalidateCreatedProject()
                setQuality(value)
              }}
              onDurationChange={(value) => {
                invalidateCreatedProject()
                setDuration(value)
              }}
            />
          </motion.div>
        )}
        {stage === 'creating' && (
          <motion.p
            key="handoff"
            className="text-muted-foreground px-2 pt-4 text-xs"
            {...accessory}
          >
            创建后将在项目画布展示真实阶段、产物与错误状态。
          </motion.p>
        )}
      </AnimatePresence>
      <LoginRequiredDialog open={loginRequired} onClose={closeLoginDialog} />
    </div>
  )
}
