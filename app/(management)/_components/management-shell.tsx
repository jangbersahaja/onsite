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
};

export function ManagementShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [canManageOutlets, setCanManageOutlets] = useState(false);
  const pageTitle = pageTitles[pathname] ?? "Management";

  useEffect(() => {
    let active = true;
    fetch("/api/team", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = (await response.json()) as { isAdmin?: boolean };
        return body.isAdmin === true;
      })
      .then((isAdmin) => {
        if (active) setCanManageOutlets(isAdmin);
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
