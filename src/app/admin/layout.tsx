import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdminSession } from "@/features/auth/page-session";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdminSession("/admin");
  return children;
}
