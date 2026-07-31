import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalFsStorage } from '@/lib/storage/local-fs'
import {
  degradedManifestStorageKey,
  finalVideoStorageKey,
} from './final-output-storage'

const PROJECT_ID = '00000000-0000-4000-8000-000000000101'
const PREVIOUS_ATTEMPT_ID = '00000000-0000-4000-8000-000000000201'
const CURRENT_ATTEMPT_ID = '00000000-0000-4000-8000-000000000202'
const CONTENT_HASH = 'a'.repeat(64)

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

describe('final output storage isolation', () => {
  it('keeps an earlier final video when a later attempt cleans up the same hash', async () => {
    const storage = await localStorage()
    const previousKey = finalVideoStorageKey({
      projectId: PROJECT_ID,
      attemptId: PREVIOUS_ATTEMPT_ID,
      contentHash: CONTENT_HASH,
    })
    const currentKey = finalVideoStorageKey({
      projectId: PROJECT_ID,
      attemptId: CURRENT_ATTEMPT_ID,
      contentHash: CONTENT_HASH,
    })

    expect(currentKey).not.toBe(previousKey)
    await storage.put(previousKey, Buffer.from('approved-final'))
    await storage.put(currentKey, Buffer.from('current-final'))
    await storage.delete(currentKey)

    await expect(storage.get(previousKey)).resolves.toEqual(
      Buffer.from('approved-final')
    )
    await expect(storage.exists(currentKey)).resolves.toBe(false)
  })

  it('isolates degraded manifests by attempt as well as final hash', () => {
    const previousKey = degradedManifestStorageKey({
      projectId: PROJECT_ID,
      attemptId: PREVIOUS_ATTEMPT_ID,
      contentHash: CONTENT_HASH,
    })
    const currentKey = degradedManifestStorageKey({
      projectId: PROJECT_ID,
      attemptId: CURRENT_ATTEMPT_ID,
      contentHash: CONTENT_HASH,
    })

    expect(currentKey).not.toBe(previousKey)
    expect(previousKey).toContain(PREVIOUS_ATTEMPT_ID)
    expect(currentKey).toContain(CURRENT_ATTEMPT_ID)
  })
})

async function localStorage(): Promise<LocalFsStorage> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pi-final-output-'))
  temporaryDirectories.push(directory)
  return new LocalFsStorage(directory)
}
