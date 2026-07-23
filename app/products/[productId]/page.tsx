import { notFound } from "next/navigation";

export default async function ProductOverviewPage({ params }: { params: Promise<{ productId: string }> }): Promise<never> {
  await params;
  notFound();
}
