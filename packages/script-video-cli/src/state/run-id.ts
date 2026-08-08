export function createRunId(inputHash: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')
  return `${timestamp}-${inputHash.slice(0, 12)}`
}
