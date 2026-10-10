import { ManagementShell } from "@/app/(management)/_components/management-shell";
import { getSession } from "@/lib/auth-instance";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

export default async function ManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getSession(await headers());
  if (!session) redirect("/clock");

  return <ManagementShell>{children}</ManagementShell>;
}
