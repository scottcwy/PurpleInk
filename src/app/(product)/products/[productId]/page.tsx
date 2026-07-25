import { RouteShellPage } from "../../_components/route-shell-page";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return (
    <RouteShellPage
      eyebrow="Product context"
      title="Product detail"
      context={`productId: ${productId}`}
      description="动态参数仅标识未来要读取的 Product；当前不推断名称、状态、BrandKit 完整度或 Flow 数量。"
      sources={["Product", "BrandKit", "ProductCapability", "ProductFlow"]}
    />
  );
}
