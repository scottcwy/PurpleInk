import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface ShotMediaServiceDependencies {
  speechMediaPort: DomainTaskPort
}

export function createShotMediaService({
  speechMediaPort,
}: ShotMediaServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[3], speechMediaPort)
}

export const shotMediaService = createShotMediaService({
  speechMediaPort: createPendingDomainPort("分镜媒体"),
})
