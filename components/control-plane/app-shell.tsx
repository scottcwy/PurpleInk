import {
  Bell,
  Boxes,
  LayoutDashboard,
  Package,
  Rocket,
  Settings,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/releases", label: "Releases", icon: Rocket },
] as const;

type AppShellProps = {
  currentPath: string;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function AppShell({
  currentPath,
  title,
  description,
  action,
  children,
}: AppShellProps): ReactNode {
  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-white/10 bg-ink-panel text-ink-panel-text lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div className="flex h-16 items-center justify-between px-5 lg:h-auto lg:px-6 lg:pt-6 lg:pb-8">
          <Link href="/dashboard" className="focus-ring flex items-center gap-3">
            <Image src="/svg/logo.svg" alt="PurpleInk" width={100} height={28} />
          </Link>
          <button
            type="button"
            className="focus-ring inline-flex size-10 items-center justify-center rounded-[8px] text-ink-panel-muted hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Notifications"
          >
            <Bell size={18} />
          </button>
        </div>

        <div className="hidden px-4 lg:block">
          <button
            type="button"
            className="focus-ring flex h-12 w-full items-center gap-3 rounded-[8px] bg-ink-panel-soft px-3 text-left hover:bg-white/8"
          >
            <span className="flex size-7 items-center justify-center rounded-[6px] bg-accent text-accent-foreground">
              <Boxes size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[10px] text-ink-panel-muted uppercase">
                Workspace
              </span>
              <span className="block truncate text-xs font-medium">PurpleInk</span>
            </span>
          </button>
        </div>

        <nav
          aria-label="Workspace"
          className="flex gap-1 overflow-x-auto px-3 pb-3 lg:mt-7 lg:block lg:space-y-1 lg:px-4"
        >
          {navigation.map(({ href, label, icon: Icon }) => {
            const isActive = currentPath === href || currentPath.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={`focus-ring flex h-10 shrink-0 items-center gap-3 rounded-[8px] px-3 text-sm transition-colors ${
                  isActive
                    ? "bg-white text-ink-panel"
                    : "text-ink-panel-muted hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={17} strokeWidth={1.8} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-5 hidden w-[15rem] px-4 lg:block">
          <button
            type="button"
            className="focus-ring flex h-10 w-full items-center gap-3 rounded-[8px] px-3 text-sm text-ink-panel-muted hover:bg-white/5 hover:text-white"
          >
            <Settings size={17} />
            Settings
          </button>
        </div>
      </aside>

      <main id="main-content" className="min-w-0">
        <header className="border-b border-border bg-background px-5 py-5 sm:px-8 lg:px-10 lg:py-6">
          <div className="mx-auto flex max-w-[1240px] items-start justify-between gap-5">
            <div>
              <p className="font-mono text-[10px] font-semibold text-accent-strong uppercase">
                Workspace / Release room
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-normal sm:text-[1.75rem]">
                {title}
              </h1>
              {description ? (
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {action}
          </div>
        </header>
        <div className="mx-auto max-w-[1240px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
