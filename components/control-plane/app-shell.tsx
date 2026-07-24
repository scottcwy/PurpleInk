import { Boxes, LayoutDashboard, Menu, Package, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  variant?: "standard" | "canvas";
};

export function AppShell({
  currentPath,
  title,
  description,
  action,
  children,
  variant = "standard",
}: AppShellProps): ReactNode {
  const isCanvas = variant === "canvas";

  const renderWorkspaceNavigation = (compact = false): ReactNode => {
    const navigationContent = (
      <nav
        aria-label={compact ? "Workspace switcher" : "Workspace"}
        className="flex flex-col gap-1"
      >
        {navigation.map(({ href, label, icon: Icon }) => {
          const isActive =
            currentPath === href || currentPath.startsWith(`${href}/`);
          const navigationLink = (
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              aria-label={compact ? label : undefined}
              className={`focus-ring flex h-11 items-center rounded-[var(--radius-compact)] text-sm transition-colors ${
                compact ? "justify-center px-0" : "gap-3 px-3"
              } ${
                isActive
                  ? "bg-sidebar-foreground text-ink-panel"
                  : "text-ink-panel-muted hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground"
              }`}
            >
              <Icon
                size={compact ? 19 : 17}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <span className={compact ? "sr-only" : undefined}>{label}</span>
            </Link>
          );

          if (!compact) return <div key={href}>{navigationLink}</div>;

          return (
            <Tooltip key={href}>
              <TooltipTrigger asChild>{navigationLink}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    );

    return compact ? (
      <TooltipProvider>{navigationContent}</TooltipProvider>
    ) : (
      navigationContent
    );
  };

  return (
    <div
      className={`bg-background text-foreground min-h-screen lg:grid ${
        isCanvas
          ? "lg:grid-cols-[5rem_minmax(0,1fr)]"
          : "lg:grid-cols-[15rem_minmax(0,1fr)]"
      }`}
    >
      <aside className="bg-ink-panel text-ink-panel-text border-sidebar-border border-b lg:sticky lg:top-0 lg:h-screen lg:border-r lg:border-b-0">
        <div
          className={`flex h-16 items-center justify-between px-5 ${
            isCanvas
              ? "lg:h-20 lg:justify-center lg:px-0"
              : "lg:h-auto lg:px-6 lg:pt-6 lg:pb-8"
          }`}
        >
          <Link
            href="/dashboard"
            className="focus-ring flex min-h-11 items-center gap-3"
          >
            <Image
              src="/svg/logo.svg"
              alt="PurpleInk"
              width={100}
              height={28}
              className={isCanvas ? "lg:hidden" : undefined}
            />
            {isCanvas ? (
              <Image
                src="/icon.svg"
                alt=""
                width={34}
                height={34}
                className="hidden lg:block"
              />
            ) : null}
          </Link>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="text-ink-panel-muted hover:bg-sidebar-foreground/5 hover:text-sidebar-foreground lg:hidden"
                aria-label="Open workspace navigation"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="border-sidebar-border bg-sidebar text-sidebar-foreground"
            >
              <SheetHeader>
                <SheetTitle className="text-sidebar-foreground">
                  Workspace navigation
                </SheetTitle>
                <SheetDescription className="text-ink-panel-muted">
                  Workspace data unavailable
                </SheetDescription>
              </SheetHeader>
              <div className="px-4">{renderWorkspaceNavigation()}</div>
            </SheetContent>
          </Sheet>
        </div>

        <div className={isCanvas ? "hidden" : "hidden px-4 lg:block"}>
          <div className="bg-ink-panel-soft flex min-h-14 w-full items-center gap-3 rounded-[var(--radius-compact)] px-3 py-2">
            <span className="bg-accent text-accent-foreground flex size-7 items-center justify-center rounded-[var(--radius-compact)]">
              <Boxes size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-ink-panel-muted block font-mono text-xs uppercase">
                Workspace
              </span>
              <span className="block text-xs leading-4 font-medium">
                Workspace data unavailable
              </span>
            </span>
          </div>
        </div>

        <div
          className={`hidden lg:block ${
            isCanvas ? "px-3 pt-2" : "px-4 lg:mt-7"
          }`}
        >
          {renderWorkspaceNavigation(isCanvas)}
        </div>
      </aside>

      <main id="main-content" className="min-w-0">
        {isCanvas ? (
          children
        ) : (
          <>
            <header className="border-border bg-background border-b px-5 py-5 sm:px-8 lg:px-10 lg:py-6">
              <div className="mx-auto flex max-w-[1240px] items-start justify-between gap-5">
                <div>
                  <p className="text-accent-strong font-mono text-xs font-semibold uppercase">
                    Workspace / Release room
                  </p>
                  <h1 className="mt-2 text-2xl font-bold tracking-normal sm:text-3xl">
                    {title}
                  </h1>
                  {description ? (
                    <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm leading-6">
                      {description}
                    </p>
                  ) : null}
                </div>
                {action}
              </div>
            </header>
            <div className="mx-auto max-w-[1240px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
              {children}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
