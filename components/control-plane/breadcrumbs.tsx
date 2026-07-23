import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function Breadcrumbs({ items }: { items: ReadonlyArray<{ label: string; href?: string }> }): ReactNode {
  return <nav aria-label="Breadcrumb" className="mb-5"><ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">{items.map((item, index) => <li key={`${item.label}-${index}`} className="flex items-center gap-1">{index > 0 ? <ChevronRight size={13} aria-hidden="true" /> : null}{item.href ? <Link href={item.href} className="focus-ring rounded-[4px] px-1 py-0.5 font-semibold hover:text-accent-strong">{item.label}</Link> : <span aria-current="page" className="px-1 py-0.5 text-foreground">{item.label}</span>}</li>)}</ol></nav>;
}
