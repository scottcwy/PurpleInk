'use client'

import { Toast } from '@/components/ui/toast'
import type { ReadyModelSettingsController } from './model-service-contract'
import { ProviderRegistryPanel } from './provider-registry-panel'
import { WorkflowRoutePanel } from './workflow-route-panel'

export function ModelServicePanels({
  controller,
}: {
  controller: ReadyModelSettingsController
}) {
  return (
    <>
      <ProviderRegistryPanel controller={controller} />
      <WorkflowRoutePanel
        routes={controller.routes}
        effective={controller.data.routes}
        busy={controller.busy === 'routes'}
        onChange={controller.setRoute}
        onSave={() => controller.submit({ routes: controller.routes }, 'routes')}
      />
      {controller.error && (
        <Toast variant="error" title="模型配置失败" body={controller.error} />
      )}
    </>
  )
}
