import { LayoutDashboard, Folder } from 'lucide-react'
import { NavItem } from './nav-item'

/** NavItem 示例（/playbook 展示单元）。 */
export function NavItemDemo() {
  return (
    <div className="flex w-52 flex-col gap-1">
      <NavItem icon={LayoutDashboard} active>
        工作台
      </NavItem>
      <NavItem icon={Folder}>项目列表</NavItem>
    </div>
  )
}
