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
          <p className="mt-5 max-w-xs text-sm leading-6 text-zinc-400">
            Keep every launch tied to approved product truth.
          </p>
        </div>

        <p className="font-mono text-[11px] tracking-widest text-zinc-500 uppercase">
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
          <p className="text-accent-strong font-mono text-[11px] tracking-widest uppercase">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal sm:text-4xl">
            {title}
          </h1>
          <div className="mt-9">{children}</div>
          <div className="mt-8 text-sm text-zinc-600">{footer}</div>
        </div>
      </section>
    </main>
  );
}

export const authInputClassName =
  "mt-2 h-11 w-full border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-accent";

export const authButtonClassName =
  "focus-ring mt-2 inline-flex h-11 w-full items-center justify-center gap-2 bg-foreground px-4 text-sm font-semibold text-background transition-colors hover:bg-accent hover:text-accent-foreground";
