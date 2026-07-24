import type { ReactNode } from "react";

export type CollectionRow = {
  id: string;
  title: string;
  description: string;
  metadata: ReadonlyArray<string>;
  status: string;
  href: string;
};

export function CollectionView({
  ariaLabel,
  rows,
}: {
  ariaLabel: string;
  rows: ReadonlyArray<CollectionRow>;
}): ReactNode {
  return (
    <div className="border-border overflow-x-auto border">
      <Table aria-label={ariaLabel} className="min-w-[44rem]">
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Context</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <strong className="block text-sm font-semibold">
                  {row.title}
                </strong>
                <span className="text-muted-foreground mt-1 block max-w-[48ch] truncate text-xs">
                  {row.description}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{row.status}</Badge>
              </TableCell>
              <TableCell>
                <span className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {row.metadata.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </span>
              </TableCell>
              <TableCell>
                <Link
                  href={row.href}
                  className="focus-ring hover:bg-muted flex size-11 items-center justify-center rounded-[var(--radius-compact)]"
                  aria-label={`Open ${row.title}`}
                >
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
