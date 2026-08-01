import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdminSession } from "@/features/auth/page-session";
import { AdminShell } from "@/features/admin/ui/admin-shell";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdminSession("/admin");
  return (
    <AdminShell account={{ name: session.name, email: session.email }}>
      {children}
    </AdminShell>
  );
}
