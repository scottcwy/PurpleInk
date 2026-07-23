import { AlertTriangle, Check, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function StatusBadge({
  status,
}: {
  status: "passed" | "failed" | "running" | "pending" | "approved" | "draft";
}): ReactNode {
  const config =
    status === "passed" || status === "approved"
      ? {
          label: status === "approved" ? "Approved" : "Passed",
          Icon: Check,
          className: "bg-proof text-proof-ink",
        }
      : status === "failed"
        ? {
            label: "Failed",
            Icon: AlertTriangle,
            className: "bg-signal text-signal-ink",
          }
        : status === "running"
          ? {
              label: "Running",
              Icon: LoaderCircle,
              className: "bg-accent-light text-accent-strong",
            }
          : {
              label: status === "draft" ? "Draft" : "Pending",
              Icon: LoaderCircle,
              className: "bg-muted text-muted-foreground",
            };
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-mono text-[10px] font-semibold ${config.className}`}
    >
      <config.Icon size={12} aria-hidden="true" />
      {config.label}
    </span>
  );
}
