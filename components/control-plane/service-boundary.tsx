import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ServerOff } from "lucide-react";
import type { ReactNode } from "react";

type ServiceBoundaryProps = {
  title: string;
  description: string;
  regions: ReadonlyArray<string>;
  children?: ReactNode;
};

export function ServiceBoundary({
  title,
  description,
  regions,
  children,
}: ServiceBoundaryProps): ReactNode {
  return (
    <section
      className="flex flex-col gap-6"
      aria-labelledby="service-boundary-title"
    >
      <Alert className="border-signal bg-signal-soft text-signal-ink">
        <ServerOff aria-hidden="true" />
        <AlertTitle id="service-boundary-title">{title}</AlertTitle>
        <AlertDescription className="text-signal-ink">
          {description}
        </AlertDescription>
      </Alert>

      {children}

      <section aria-labelledby="planned-regions-title">
        <div className="border-border flex items-center justify-between gap-4 border-b pb-3">
          <div>
            <h2 id="planned-regions-title" className="text-base font-semibold">
              Page structure
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              These regions are ready to receive real service data.
            </p>
          </div>
          <Badge variant="outline">Frontend contract</Badge>
        </div>
        <ol
          className="border-border bg-border grid gap-px border-x border-b sm:grid-cols-2 xl:grid-cols-3"
          aria-label="Planned page regions"
        >
          {regions.map((region, index) => (
            <li
              key={region}
              className="bg-background flex min-h-24 items-start gap-3 p-4"
            >
              <span className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-compact)] font-mono text-xs">
                {index + 1}
              </span>
              <span className="pt-1 text-sm font-medium">{region}</span>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
