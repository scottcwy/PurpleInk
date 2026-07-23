import { notFound } from "next/navigation";

export default async function ProductFlowsPage({ params }: { params: Promise<{ productId: string }> }): Promise<never> {
  await params;
  notFound();
}
