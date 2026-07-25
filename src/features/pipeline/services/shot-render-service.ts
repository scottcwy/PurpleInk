import { CVC_TASK_IDS } from "../contracts/task-ids"
import {
  createPendingDomainPort,
  createTaskService,
  type DomainTaskPort,
  type DomainTaskService,
} from "./task-service"

export interface ShotRenderServiceDependencies {
  shotRenderPort: DomainTaskPort
}

export function createShotRenderService({
  shotRenderPort,
}: ShotRenderServiceDependencies): DomainTaskService {
  return createTaskService(CVC_TASK_IDS[4], shotRenderPort)
}

export const shotRenderService = createShotRenderService({
  shotRenderPort: createPendingDomainPort("分镜渲染"),
})
