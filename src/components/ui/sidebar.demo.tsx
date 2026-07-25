import {
  LayoutDashboard,
  Folder,
  Waypoints,
  Film,
  Download,
  Settings,
} from 'lucide-react'
import { NavItem } from './nav-item'
import {
  Sidebar,
  SidebarBrand,
  SidebarDivider,
  SidebarFooter,
  SidebarLocalStatus,
  SidebarNav,
  SidebarSearch,
  SidebarSection,
} from './sidebar'

/** Sidebar 示例（/playbook 展示单元）。 */
export function SidebarDemo() {
  return (
    <div className="h-96">
      <Sidebar>
        <SidebarBrand />
        <SidebarSearch />
        <SidebarSection>项目</SidebarSection>
        <SidebarNav>
          <NavItem icon={LayoutDashboard} active>
            工作台
          </NavItem>
          <NavItem icon={Folder}>项目列表</NavItem>
          <NavItem icon={Waypoints}>画布编辑器</NavItem>
          <NavItem icon={Film}>分镜渲染器</NavItem>
          <NavItem icon={Download}>合成与导出</NavItem>
        </SidebarNav>
        <SidebarDivider />
        <SidebarFooter>
          <NavItem icon={Settings}>设置</NavItem>
          <SidebarLocalStatus />
        </SidebarFooter>
      </Sidebar>
    </div>
  )
}
