import { ProjectStatisticsPanel } from './project-statistics-panel'

export function ProjectStatisticsPanelDemo() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-ds-text-muted">
        默认展示项目统计；切换「API 调用统计」可查看标注演示数据。
      </p>
      <ProjectStatisticsPanel
        metrics={[
          { label: '项目总数', value: '3', source: 'projects.total' },
          { label: '活跃 Pipeline', value: '1', source: 'pipelines.active' },
          { label: '已提交 Artifact', value: '8', source: 'artifacts.committed' },
          { label: '平均镜头数', value: '5.3', source: 'shots.average' },
        ]}
        statusDistribution={{ running: 1, failed: 0, succeeded: 2, idle: 0 }}
        trendUnavailableLabel="尚无历史快照可绘制"
        updatedLabel="Playbook fixture · 项目视图"
      />
    </div>
  )
}
