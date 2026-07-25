import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface ProjectPlanServiceDependencies {
  projectPlanPort: DomainTaskPort
}

export function createProjectPlanService({
  projectPlanPort,
}: ProjectPlanServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[1], projectPlanPort)
}

export const projectPlanService = createProjectPlanService({
  projectPlanPort: createPendingDomainPort("项目规划"),
})
