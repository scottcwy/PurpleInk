import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface ShotGenerateServiceDependencies {
  shotGeneratePort: DomainTaskPort
}

export function createShotGenerateService({
  shotGeneratePort,
}: ShotGenerateServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[2], shotGeneratePort)
}

export const shotGenerateService = createShotGenerateService({
  shotGeneratePort: createPendingDomainPort("分镜生成"),
})
