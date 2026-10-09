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
  "/device-requests": "Device requests",
  "/timesheets": "Timesheets",
  "/corrections/review": "Review requests",
  "/team": "Team",
};

type OutletSummary = { id: string; name: string };
type TeamSummary = { outlets?: OutletSummary[]; isAdmin?: boolean };

export default function ManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [outlets, setOutlets] = useState<OutletSummary[]>([]);
  const [canManageOutlets, setCanManageOutlets] = useState(false);

  const basePageTitle = pathname.endsWith("/timesheets")
    ? "Timesheets"
    : pathname.endsWith("/corrections/review")
      ? "Review requests"
      : pathname.endsWith("/team")
        ? "Team"
        : (pageTitles[pathname] ?? "Management");
  const outletId = pathname.match(/^\/outlets\/([^/]+)\//)?.[1];
  const outletName = outlets.find((outlet) => outlet.id === outletId)?.name;
  const pageTitle = outletName
    ? `${outletName} · ${basePageTitle}`
    : basePageTitle;

  useEffect(() => {
    let active = true;
    fetch("/api/team", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return [];
        const body = (await response.json()) as TeamSummary;
        if (active) setCanManageOutlets(body.isAdmin === true);
        return Array.isArray(body.outlets) ? body.outlets : [];
      })
      .then((availableOutlets) => {
        if (active) setOutlets(availableOutlets);
      })
      .catch(() => {
        if (active) setOutlets([]);
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
      navigation={createManagementNavigation(outlets, canManageOutlets)}
    >
      {children}
    </WorkspaceShell>
  );
}
