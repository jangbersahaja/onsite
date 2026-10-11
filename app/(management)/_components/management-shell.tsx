"use client";

import {
  createManagementNavigation,
  WorkspaceShell,
} from "@/app/_components/workspace-shell";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const pageTitles: Record<string, string> = {
  "/manage": "Dashboard",
  "/outlets": "Outlets",
  "/timesheets": "Timesheets",
  "/corrections/review": "Review requests",
  "/team": "Team",
  "/activity": "Activity",
};

export function ManagementShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [canManageOutlets, setCanManageOutlets] = useState(false);
  const pageTitle = pageTitles[pathname] ?? "Management";

  useEffect(() => {
    let active = true;
    // /api/team returns 403 without backoffice access, so a successful
    // response means the viewer can manage outlets.
    fetch("/api/team", { cache: "no-store" })
      .then((response) => {
        if (active) setCanManageOutlets(response.ok);
      })
      .catch(() => {
        if (active) setCanManageOutlets(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <WorkspaceShell
      activeHref={pathname}
      pageTitle={pageTitle}
      workspaceName="Operations"
      navigation={createManagementNavigation(canManageOutlets)}
    >
      {children}
    </WorkspaceShell>
  );
}
