import type { MeasuredAudio } from '@/features/audio/measure'
import type { StorageAdapter } from '@/lib/storage'
import type {
  CreatedProject,
  CreateProjectWithSourceInput,
  ProjectCreationDependencies,
} from './project-creation'

export const MAX_PROJECT_AUDIO_BYTES = 100 * 1024 * 1024
export const MAX_PROJECT_AUDIO_DURATION_MS = 30 * 60 * 1000

type ProjectCreator = (
  input: CreateProjectWithSourceInput,
  dependencies?: ProjectCreationDependencies,
) => Promise<CreatedProject>

export interface ProjectCreateRequestDependencies {
  storage?: Pick<StorageAdapter, 'put' | 'delete'>
  measureAudio?: (bytes: Buffer) => Promise<MeasuredAudio>
  createProject?: ProjectCreator
  getWorkspaceId?: () => string
  createId?: () => string
  database?: ProjectCreationDependencies['database']
}

export class ProjectCreateInputError extends Error {
  constructor(
    message: string,
    readonly code = 'INVALID_PROJECT_INPUT',
    readonly statusCode = 400,
  ) {
    super(message)
    this.name = 'ProjectCreateInputError'
  }
}
