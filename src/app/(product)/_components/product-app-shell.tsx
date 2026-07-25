import type { ReactNode } from "react";
import Link from "next/link";
import { Clapperboard, LogIn, Package, Rocket, Shapes } from "lucide-react";

const PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Shapes },
  { href: "/products", label: "Products", icon: Package },
  { href: "/releases", label: "Releases", icon: Rocket },
] as const;

export function ProductAppShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#f4f0e8] text-[#171511] dark:bg-[#151412] dark:text-[#f5efe6]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(87,72,55,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(87,72,55,.045) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}
    >
      <header className="sticky top-0 z-30 border-b border-[#d8d0c4] bg-[#f4f0e8]/92 backdrop-blur-xl dark:border-white/10 dark:bg-[#151412]/92">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="mr-auto flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-[#171511] text-[#fffaf1] dark:bg-[#f4ede2] dark:text-[#171511]">
              <Clapperboard aria-hidden className="size-4" />
            </span>
            <span>
              <span className="block font-serif text-lg leading-none">PurpleInk</span>
              <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.16em] text-[#867b6f]">
                Product release studio
              </span>
            </span>
          </Link>

          <nav aria-label="产品主导航" className="order-3 w-full sm:order-none sm:w-auto">
            <ul className="flex gap-1">
              {PRIMARY_NAV.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-[#625a50] transition-colors hover:bg-[#e8e1d6] hover:text-[#171511] dark:text-[#bdb4a8] dark:hover:bg-white/8 dark:hover:text-white"
                  >
                    <Icon aria-hidden className="size-4" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-[#d9d1c4] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[#756c61] dark:border-white/10 dark:text-[#a9a094] md:inline-flex">
              Stage A · Route shell
            </span>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-full bg-[#e75c3c] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#c9472b]"
            >
              <LogIn aria-hidden className="size-4" />
              Login
            </Link>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
