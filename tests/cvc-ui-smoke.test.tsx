import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

describe("CodeVideoCanvas UI 组件烟测", () => {
  it("可同时渲染 Button、Card 与 StatusPill", () => {
    const markup = renderToStaticMarkup(
      <Card>
        <CardTitle>组件烟测</CardTitle>
        <CardBody>
          <StatusPill variant="pending" />
          <Button type="button">继续</Button>
        </CardBody>
      </Card>,
    );

    expect(markup).toContain("组件烟测");
    expect(markup).toContain("待生成");
    expect(markup).toContain("继续");
  });
});
