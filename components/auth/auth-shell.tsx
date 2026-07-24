import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

type AuthShellProps = {
  eyebrow: string;
  title: string;
  footer: ReactNode;
  children: ReactNode;
};

export function AuthShell({
  eyebrow,
  title,
  footer,
  children,
}: AuthShellProps): ReactNode {
  return (
    <main
      id="main-content"
      className="bg-background text-foreground grid min-h-screen lg:grid-cols-[minmax(20rem,0.78fr)_minmax(32rem,1.22fr)]"
    >
      <aside className="bg-ink-panel text-ink-panel-text relative hidden overflow-hidden border-r border-white/10 p-10 lg:flex lg:flex-col lg:justify-between">
        <Link
          href="/"
          className="focus-ring inline-flex w-fit items-center gap-3"
        >
          <Image src="/svg/logo.svg" alt="" width={30} height={30} />
          <span className="text-sm font-semibold">PurpleInk</span>
        </Link>

        <div className="max-w-sm">
          <div className="mb-8 flex items-center gap-2" aria-hidden="true">
            <span className="bg-brand-spectrum-end h-px w-12" />
            <span className="bg-brand-spectrum-end h-2 w-2" />
          </div>
          <p className="text-3xl leading-tight font-medium">
            Evidence in.
            <br />
            Release video out.
          </p>
          <p className="text-ink-panel-muted mt-5 max-w-xs text-sm leading-6">
            Keep every launch tied to approved product truth.
          </p>
        </div>

        <p className="text-ink-panel-muted font-mono text-xs uppercase">
          Continuous release video
        </p>
      </aside>

      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-md">
          <Link
            href="/"
            className="focus-ring mb-14 inline-flex items-center gap-3 lg:hidden"
          >
            <Image src="/svg/logo.svg" alt="" width={28} height={28} />
            <span className="text-sm font-semibold">PurpleInk</span>
          </Link>
          <p className="text-accent-strong font-mono text-xs uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal sm:text-4xl">
            {title}
          </h1>
          <div className="mt-9">{children}</div>
          <div className="text-muted-foreground mt-8 text-sm">{footer}</div>
        </div>
      </section>
    </main>
  );
}

export const authInputClassName = "h-12 rounded-[var(--radius-control)]";

export const authButtonClassName = "mt-1 h-12 w-full";
