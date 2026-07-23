# @purpleink/product-flow

Canonical ProductFlow DSL V1 and provider-independent domain boundary shared by the PurpleInk web application and Linux Playwright Capture Worker.

```ts
import {
  ProductFlowVersionV1Schema,
  ProductFlowVersionService,
  parseProductFlowV1,
  resolveFlowCapabilityProofs,
} from "@purpleink/product-flow";
```

`ProductFlowVersionV1Schema` validates the persisted document shape. `parseProductFlowV1` additionally enforces graph and approval-safety rules. The version service accepts a storage adapter through `ProductFlowVersionRepository`; adapters must implement `createNext` atomically and preserve approved-version immutability. `InMemoryProductFlowVersionRepository` is provided for local consumers and tests.

Execution state, Playwright locator handles, temporary DOM refs, browser coordinates, temporary backend node ids, and page-specific view models do not belong in this package's persisted payload.
