"use client";

import { managementNavigation, WorkspaceShell } from "@/app/workspace-shell";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const pageTitles: Record<string, string> = {
  "/manage": "Dashboard",
  "/timesheets": "Timesheets",
  "/corrections/review": "Review requests",
  "/team": "Team",
};

export default function ManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <WorkspaceShell
      activeHref={pathname}
      pageTitle={pageTitles[pathname] ?? "Management"}
      workspaceName="Operations"
      navigation={managementNavigation}
    >
      {children}
    </WorkspaceShell>
  );
}
