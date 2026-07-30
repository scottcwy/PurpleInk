interface AttemptBoundOutput {
  projectId: string
  attemptId: string
  contentHash: string
}

export function finalVideoStorageKey(input: AttemptBoundOutput): string {
  return outputPrefix(input)
    + `/final-${input.contentHash}.mp4`
}

export function degradedManifestStorageKey(
  input: AttemptBoundOutput
): string {
  return outputPrefix(input)
    + `/final-${input.contentHash}.degraded.json`
}

function outputPrefix(input: AttemptBoundOutput): string {
  return `exports/${input.projectId}/attempts/${input.attemptId}`
}
