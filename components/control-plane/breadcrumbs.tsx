import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function Breadcrumbs({
  items,
}: {
  items: ReadonlyArray<{ label: string; href?: string }>;
}): ReactNode {
  return (
    <nav aria-label="Breadcrumb" className="mb-5">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
        {items.map((item, index) => (
          <li
            key={`${item.label}-${index}`}
            className="flex items-center gap-1"
          >
            {index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}
            {item.href ? (
              <Link
                href={item.href}
                className="focus-ring hover:text-accent-strong rounded-[var(--radius-compact)] px-1 py-0.5 font-semibold"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-foreground px-1 py-0.5">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
