export class ArtifactValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`产物校验失败：${errors.join('；')}`)
    this.name = 'ArtifactValidationError'
  }
}
