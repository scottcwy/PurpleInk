import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface ProjectComposeServiceDependencies {
  projectComposePort: DomainTaskPort
}

export function createProjectComposeService({
  projectComposePort,
}: ProjectComposeServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[6], projectComposePort)
}

export const projectComposeService = createProjectComposeService({
  projectComposePort: createPendingDomainPort("项目合成"),
})
