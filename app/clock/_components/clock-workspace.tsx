"use client";

import { useLocale } from "@/app/_components/locale-provider";
import {
  WorkspaceShell,
  type WorkspaceNavigationGroup,
  type WorkspaceOutlet,
} from "@/app/_components/workspace-shell";
import { authClient } from "@/lib/auth-client";
import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type ClockWorkspaceReport = {
  pageTitle: string;
  workspaceName?: string;
  outlets?: WorkspaceOutlet[];
  selectedOutletId?: string;
  onOutletChange?: (outletId: string) => void;
  isOutletLocked?: boolean;
  dateLabel?: string;
  reconciliationCount: number;
};

const ClockWorkspaceReportContext = createContext<
  ((report: ClockWorkspaceReport) => void) | null
>(null);

export function useReportClockWorkspace(report: ClockWorkspaceReport) {
  const setReport = useContext(ClockWorkspaceReportContext);
  useEffect(() => {
    setReport?.(report);
  }, [setReport, report]);
}

export function ClockWorkspaceFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { messages } = useLocale();
  const session = authClient.useSession();
  const [report, setReport] = useState<ClockWorkspaceReport>({
    pageTitle: "",
    reconciliationCount: 0,
  });
  const user = session.data?.user;
  const navigation: WorkspaceNavigationGroup[] = [
    {
      label: messages.clock.navigation.myTime,
      items: [
        {
          href: "/clock",
          label: messages.clock.navigation.clock,
          glyph: "◷",
          requiredAccess: "clock",
        },
        {
          href: "/clock/history",
          label: messages.clock.navigation.history,
          glyph: "▤",
          requiredAccess: "clock",
          count: report.reconciliationCount,
        },
      ],
    },
    ...(user?.canAccessBackoffice
      ? [
          {
            label: messages.clock.navigation.workspace,
            items: [
              {
                href: "/manage",
                label: messages.clock.navigation.backoffice,
                glyph: "▤",
                requiredAccess: "backoffice" as const,
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <ClockWorkspaceReportContext.Provider value={setReport}>
      {user?.canAccessClock ? (
        <WorkspaceShell
          activeHref={pathname}
          pageTitle={report.pageTitle}
          workspaceName={report.workspaceName}
          outlets={report.outlets}
          selectedOutletId={report.selectedOutletId}
          onOutletChange={report.onOutletChange}
          isOutletLocked={report.isOutletLocked}
          dateLabel={report.dateLabel}
          navigation={navigation}
        >
          {children}
        </WorkspaceShell>
      ) : (
        children
      )}
    </ClockWorkspaceReportContext.Provider>
  );
}
