const controllers = new Map<string, AbortController>()

export function registerAttemptController(attemptId: string): AbortController {
  const controller = new AbortController()
  controllers.set(attemptId, controller)
  return controller
}

export function unregisterAttemptController(
  attemptId: string,
  controller: AbortController,
): void {
  if (controllers.get(attemptId) === controller) controllers.delete(attemptId)
}

export function abortAttempts(attemptIds: readonly string[]): void {
  for (const attemptId of attemptIds) {
    controllers.get(attemptId)?.abort(new Error('PROJECT_EXECUTION_CANCELLED'))
  }
}
