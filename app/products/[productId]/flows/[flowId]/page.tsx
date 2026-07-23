import { notFound } from "next/navigation";

export default async function ProductFlowPage({ params }: { params: Promise<{ productId: string; flowId: string }> }): Promise<never> {
  await params;
  notFound();
}
