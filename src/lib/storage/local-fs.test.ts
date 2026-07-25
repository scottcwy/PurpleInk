import { mkdtempSync, rmSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LocalFsStorage } from './local-fs'

describe('LocalFsStorage', () => {
  let root: string
  let storage: LocalFsStorage
  const tempDirs: string[] = []

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'cvc-storage-'))
    storage = new LocalFsStorage(root)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    for (const directory of tempDirs) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('put/get round-trips content', async () => {
    await storage.put('a/b.txt', 'hello 视频')
    const buffer = await storage.get('a/b.txt')
    expect(buffer.toString('utf8')).toBe('hello 视频')
  })

  it('exists reflects presence and delete removes', async () => {
    await storage.put('c.bin', Buffer.from([1, 2, 3]))
    expect(await storage.exists('c.bin')).toBe(true)
    await storage.delete('c.bin')
    expect(await storage.exists('c.bin')).toBe(false)
  })

  it('localPath resolves under root', () => {
    expect(storage.localPath('x/y.mp4')).toBe(path.join(root, 'x/y.mp4'))
  })

  it('tempDir creates a unique existing directory each call', async () => {
    const first = await storage.tempDir('cvc-unit-')
    const second = await storage.tempDir('cvc-unit-')
    tempDirs.push(first, second)
    expect(first).not.toBe(second)
    expect((await stat(first)).isDirectory()).toBe(true)
    expect((await stat(second)).isDirectory()).toBe(true)
  })

  it('readLocalFile reads content by absolute path', async () => {
    const directory = await storage.tempDir('cvc-unit-')
    tempDirs.push(directory)
    const file = path.join(directory, 'inner.bin')
    await writeFile(file, Buffer.from([9, 8, 7]))
    const buffer = await storage.readLocalFile(file)
    expect([...buffer]).toEqual([9, 8, 7])
  })

  it('removeTempDir recursively deletes the directory', async () => {
    const directory = await storage.tempDir('cvc-unit-')
    await writeFile(path.join(directory, 'inner.txt'), 'x')
    await storage.removeTempDir(directory)
    await expect(stat(directory)).rejects.toThrow()
  })

  it('removeTempDir on a missing path resolves without throwing', async () => {
    await expect(
      storage.removeTempDir(path.join(root, 'does-not-exist'))
    ).resolves.toBeUndefined()
  })
})
