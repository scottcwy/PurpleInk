import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface ShotQaServiceDependencies {
  shotQaPort: DomainTaskPort
}

export function createShotQaService({
  shotQaPort,
}: ShotQaServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[5], shotQaPort)
}

export const shotQaService = createShotQaService({
  shotQaPort: createPendingDomainPort("分镜质检"),
})
