"use client";

import type { ReactNode } from "react";
import Link from "next/link";

export function BottomCTA(): ReactNode {
  return (
    <section className="px-4 py-24 sm:px-6 lg:px-8">
      <div className="bg-muted/50 relative mx-auto max-w-7xl overflow-hidden rounded-3xl">
        <div className="relative z-10 px-8 py-12 sm:px-12">
          <div className="max-w-xl">
            <h2 className="text-foreground text-2xl font-medium tracking-tight sm:text-3xl">
              Get early access
            </h2>
            <p className="text-muted-foreground mt-3 max-w-md text-lg">
              Every week, we ship new AI-powered design features. Join and be
              first in line to shape what we build next.
            </p>

            <form className="mt-8 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                placeholder="you@company.com"
                className="bg-background text-foreground placeholder:text-muted-foreground h-12 appearance-none rounded-xl border-0 px-6 shadow-none ring-0! transition-shadow duration-200 outline-none! focus:border-0 focus:shadow-[var(--shadow-field-focus-light)] sm:min-w-86 dark:focus:shadow-[var(--shadow-field-focus-dark)]"
                required
              />
              <button
                type="submit"
                className="bg-background text-foreground h-12 cursor-pointer rounded-full px-8 font-medium transition-opacity hover:opacity-90"
              >
                Join waitlist
              </button>
            </form>

            <p className="text-muted-foreground mt-4 max-w-xs text-xs">
              We respect your inbox. No spam, just product updates.{" "}
              <Link href="#" className="hover:text-foreground underline">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>

        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 opacity-25 sm:opacity-25"
          style={{
            background: "var(--gradient-edge-spectrum)",
            maskImage:
              "linear-gradient(to left, black 0%, black 40%, transparent 100%)",
            WebkitMaskImage:
              "linear-gradient(to left, black 0%, black 40%, transparent 100%)",
          }}
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
