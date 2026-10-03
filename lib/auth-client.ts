"use client";

import { useEffect, useState } from "react";

export type AuthUser = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  accountType: "super_admin" | "admin" | "staff";
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
};

type SessionState = { user: AuthUser } | null;

function useSession() {
  const [data, setData] = useState<SessionState>(null);
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        const body = (await response.json()) as { user: AuthUser | null };
        if (active) setData(body.user ? { user: body.user } : null);
      } catch {
        if (active) setData(null);
      } finally {
        if (active) setIsPending(false);
      }
    }

    const handleSessionChange = () => void refresh();
    void refresh();
    window.addEventListener("shiftline-session-changed", handleSessionChange);
    return () => {
      active = false;
      window.removeEventListener(
        "shiftline-session-changed",
        handleSessionChange,
      );
    };
  }, []);

  return { data, isPending };
}

async function signOut() {
  await fetch("/api/auth/sign-out", { method: "POST" });
  window.dispatchEvent(new Event("shiftline-session-changed"));
}

export const authClient = { useSession, signOut };
