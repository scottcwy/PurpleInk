'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export interface NavContextValue {
  projectId?: string
  rendererNodeId?: string
}

interface NavContextStore {
  context: NavContextValue
  publish: (next: NavContextValue) => void
}

const NavContext = createContext<NavContextStore | null>(null)

/**
 * 常驻应用壳的导航上下文。
 *
 * Provider 挂在共享 layout 内，与常驻侧栏、页面内容同处一棵子树。
 * 页面（Provider 的后代）在 effect 中 `publish` 服务端可信的
 * `{ projectId, rendererNodeId }`；侧栏（同为后代）读取它构造深链。
 * 因 Provider 随 layout 常驻，侧栏只重渲染、不重挂载。
 */
export function NavContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<NavContextValue>({})

  const publish = useCallback((next: NavContextValue) => {
    setContext((current) =>
      current.projectId === next.projectId &&
      current.rendererNodeId === next.rendererNodeId
        ? current
        : next,
    )
  }, [])

  const value = useMemo<NavContextStore>(() => ({ context, publish }), [context, publish])
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>
}

/** 侧栏读取当前发布的导航上下文。Provider 缺失时返回空对象。 */
export function useNavContext(): NavContextValue {
  return useContext(NavContext)?.context ?? {}
}

/** 页面把服务端可信的 project/node 上下文发布给常驻侧栏。 */
export function usePublishNavContext(next: NavContextValue): void {
  const store = useContext(NavContext)
  const publish = store?.publish
  const { projectId, rendererNodeId } = next
  useEffect(() => {
    publish?.({ projectId, rendererNodeId })
  }, [publish, projectId, rendererNodeId])
}

/**
 * 声明式发布器：服务端页面可直接
 * `<PublishNavContext projectId={...} rendererNodeId={...} />`。
 */
export function PublishNavContext(props: NavContextValue) {
  usePublishNavContext(props)
  return null
}
