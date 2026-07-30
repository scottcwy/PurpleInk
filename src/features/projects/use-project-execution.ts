'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectExecutionSnapshot } from './project-execution-contract'
import { getProjectExecution } from './execution-client'
import {
  ExecutionSnapshotRevisionGate,
  executionPollDelay,
  SingleFlightExecutionReader,
} from './execution-sync'

interface LocalExecutionState {
  projectId: string
  initialRevision: string
  snapshot: ProjectExecutionSnapshot
}

export interface ProjectExecutionRuntime {
  execution: ProjectExecutionSnapshot
  syncInterrupted: boolean
  refresh: () => Promise<void>
  adopt: (snapshot: ProjectExecutionSnapshot) => void
}

export function useProjectExecution(
  projectId: string,
  initial: ProjectExecutionSnapshot,
): ProjectExecutionRuntime {
  const [local, setLocal] = useState<LocalExecutionState>()
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const initialRevision = initial.revision
  const execution = local?.projectId === projectId
    && local.initialRevision === initialRevision
    ? local.snapshot
    : initial
  const latestRef = useRef(execution)
  const activeKeyRef = useRef(projectId)
  const failureCountRef = useRef(0)
  const revisionGateRef = useRef(new ExecutionSnapshotRevisionGate())
  const readerRef = useRef<{
    projectId: string
    reader: SingleFlightExecutionReader
  }>({
    projectId,
    reader: new SingleFlightExecutionReader(),
  })
  useEffect(() => {
    latestRef.current = execution
    activeKeyRef.current = projectId
    failureCountRef.current = 0
    if (readerRef.current.projectId !== projectId) {
      readerRef.current = {
        projectId,
        reader: new SingleFlightExecutionReader(),
      }
      revisionGateRef.current = new ExecutionSnapshotRevisionGate()
    }
  }, [execution, projectId])

  const adopt = useCallback((snapshot: ProjectExecutionSnapshot): void => {
    revisionGateRef.current.supersedePendingRequests()
    latestRef.current = snapshot
    failureCountRef.current = 0
    setLocal({ projectId, initialRevision, snapshot })
    setConsecutiveFailures(0)
  }, [initialRevision, projectId])

  const refreshWithResult = useCallback(async (): Promise<number> => {
    const requestProjectId = projectId
    const requestSequence = revisionGateRef.current.beginRequest()
    try {
      const snapshot = await readerRef.current.reader.read(
        () => getProjectExecution(requestProjectId),
      )
      if (activeKeyRef.current !== requestProjectId) return 0
      failureCountRef.current = 0
      setConsecutiveFailures(0)
      if (!revisionGateRef.current.shouldAccept(
        requestSequence,
        latestRef.current.revision,
        snapshot.revision,
      )) {
        return 0
      }
      latestRef.current = snapshot
      setLocal({
        projectId: requestProjectId,
        initialRevision,
        snapshot,
      })
      return 0
    } catch {
      if (activeKeyRef.current !== requestProjectId) return 0
      const next = failureCountRef.current + 1
      failureCountRef.current = next
      setConsecutiveFailures(next)
      return next
    }
  }, [initialRevision, projectId])

  const refresh = useCallback(async (): Promise<void> => {
    await refreshWithResult()
  }, [refreshWithResult])

  useEffect(() => {
    if (!execution.active) return
    let cancelled = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      const failures = await refreshWithResult()
      if (cancelled) return
      const delay = executionPollDelay(latestRef.current.active, failures)
      if (delay !== null) timer = window.setTimeout(() => void poll(), delay)
    }
    timer = window.setTimeout(() => void poll(), 1_500)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [execution.active, refreshWithResult])

  useEffect(() => {
    const reconcileOnFocus = (): void => {
      if (latestRef.current.active) void refresh()
    }
    window.addEventListener('focus', reconcileOnFocus)
    document.addEventListener('visibilitychange', reconcileOnFocus)
    return () => {
      window.removeEventListener('focus', reconcileOnFocus)
      document.removeEventListener('visibilitychange', reconcileOnFocus)
    }
  }, [refresh])

  return {
    execution,
    syncInterrupted: consecutiveFailures >= 2,
    refresh,
    adopt,
  }
}
