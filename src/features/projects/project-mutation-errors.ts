/**
 * 项目写操作的错误分类。路由层只做 error → HTTP 映射，不自己判定语义。
 */

export class ProjectNotFoundError extends Error {
  readonly code = 'PROJECT_NOT_FOUND'
  readonly statusCode = 404

  constructor(message = '项目不存在') {
    super(message)
    this.name = 'ProjectNotFoundError'
  }
}

export class ProjectTitleError extends Error {
  readonly code = 'INVALID_PROJECT_TITLE'
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'ProjectTitleError'
  }
}

/**
 * 项目仍有在途执行时拒绝删除：worker 可能正握着该项目的行，
 * 删除会让它在写回时撞上外键。用户需先停止自动推进再删。
 */
export class ProjectDeleteBlockedError extends Error {
  readonly code = 'PROJECT_DELETE_BLOCKED'
  readonly statusCode = 409

  constructor(message = '项目仍有执行中的作业，请先停止自动推进后再删除') {
    super(message)
    this.name = 'ProjectDeleteBlockedError'
  }
}
