import { ProjectStatisticsPanel } from './project-statistics-panel'

export function ProjectStatisticsPanelDemo() {
  return (
    <ProjectStatisticsPanel
      metrics={[
        { label: '项目总数', value: '3', source: 'projects.total' },
        { label: '活跃 Pipeline', value: '1', source: 'pipelines.active' },
        { label: '已提交 Artifact', value: '8', source: 'artifacts.committed' },
        { label: '平均镜头数', value: '5.3', source: 'shots.average' },
      ]}
      statusDistribution={{ running: 1, failed: 0, succeeded: 2, idle: 0 }}
      trendUnavailableLabel="演示数据不包含历史时间序列"
      updatedLabel="Playbook fixture"
    />
  )
}
