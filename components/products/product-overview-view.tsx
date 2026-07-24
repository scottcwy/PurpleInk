import type { ReactNode } from "react";

export type ProductOverviewModel = {
  name: string;
  canonicalUrl: string;
  status: string;
  brandKit: string;
  capabilities: ReadonlyArray<{
    id: string;
    name: string;
    description: string;
  }>;
  flowSummary: string;
  releaseSummary: string;
};

export function ProductOverviewView({
  product,
}: {
  product: ProductOverviewModel;
}): ReactNode {
  return (
    <div className="product-overview">
      <section className="product-identity" aria-label="Product summary">
        <div>
          <span>Canonical URL</span>
          <a href={product.canonicalUrl} rel="noreferrer" target="_blank">
            {product.canonicalUrl}
            <ExternalLink aria-hidden="true" size={14} />
          </a>
        </div>
        <div>
          <span>Status</span>
          <Badge variant="outline">{product.status}</Badge>
        </div>
        <div>
          <span>Brand kit</span>
          <strong>{product.brandKit}</strong>
        </div>
      </section>

      <section
        className="capability-register"
        aria-labelledby="capabilities-title"
      >
        <header>
          <div>
            <p>Product truth</p>
            <h2 id="capabilities-title">Capabilities</h2>
          </div>
          <Badge variant="outline">
            {product.capabilities.length} registered
          </Badge>
        </header>
        <ul>
          {product.capabilities.map((capability) => (
            <li key={capability.id}>
              <span className="capability-check">
                <Check aria-hidden="true" size={16} />
              </span>
              <span>
                <strong>{capability.name}</strong>
                <small>{capability.description}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="flow-library-link"
        aria-label="Reusable product assets"
      >
        <span>
          <strong>{product.flowSummary}</strong>
          <small>
            Immutable approved versions remain available to future releases.
          </small>
        </span>
        <Workflow aria-hidden="true" />
      </section>

      <section
        className="border-border border-y py-5"
        aria-label="Release activity"
      >
        <span className="text-muted-foreground text-xs">Release activity</span>
        <strong className="mt-1 block text-sm">{product.releaseSummary}</strong>
      </section>
    </div>
  );
}
import { Badge } from "@/components/ui/badge";
import { Check, ExternalLink, Workflow } from "lucide-react";
