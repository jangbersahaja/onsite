import { ClockWorkspaceFrame } from "@/app/clock/_components/clock-workspace";
import type { ReactNode } from "react";

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return (
    <ClockWorkspaceFrame showWithoutClockAccess>{children}</ClockWorkspaceFrame>
  );
}
