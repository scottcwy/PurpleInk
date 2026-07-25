import { RouteShellPage } from "../_components/route-shell-page";

export default function ProductsPage() {
  return (
    <RouteShellPage
      eyebrow="Reusable product truth"
      title="Products"
      description="未来用于管理长期存在、可被多个 Release 复用的产品资产；当前不创建示例 Product。"
      sources={["Product", "BrandKit", "ProductCapability", "ProductFlow"]}
    />
  );
}
