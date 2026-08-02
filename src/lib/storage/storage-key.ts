import path from 'node:path'

/** Convert a safe storage key to the single POSIX form used by every backend. */
export function canonicalizeStorageKey(key: string): string {
  const normalized = key.replaceAll('\\', '/')
  const hasTraversal = normalized.split('/').includes('..')
  if (
    normalized.length === 0
    || normalized.includes('\0')
    || hasTraversal
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || /^[A-Za-z]:/u.test(normalized)
  ) {
    throw new Error('storage key 越出 root 目录')
  }
  const canonical = path.posix.normalize(normalized)
  if (canonical === '.') {
    throw new Error('storage key 越出 root 目录')
  }
  return canonical
}
