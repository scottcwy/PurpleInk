import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface PipelineRunServiceDependencies {
  orchestrationPort: DomainTaskPort
}

export function createPipelineRunService({
  orchestrationPort,
}: PipelineRunServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[0], orchestrationPort)
}

export const pipelineRunService = createPipelineRunService({
  orchestrationPort: createPendingDomainPort("项目编排"),
})
