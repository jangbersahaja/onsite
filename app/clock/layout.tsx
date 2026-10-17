import { ClockWorkspaceFrame } from "@/app/clock/_components/clock-workspace";
import type { ReactNode } from "react";

export default function ClockLayout({ children }: { children: ReactNode }) {
  return <ClockWorkspaceFrame>{children}</ClockWorkspaceFrame>;
}
