import { RecentProjectsPanel } from './recent-projects-panel'

export function RecentProjectsPanelDemo() {
  return (
    <RecentProjectsPanel
      projects={[
        {
          id: 'playbook-project',
          title: 'RAG 十分钟入门',
          href: '#',
          meta: '6 个镜头 · Playbook fixture',
          updatedAt: new Date('2026-07-25T00:00:00.000Z'),
          shotCount: 6,
        },
      ]}
    />
  )
}
