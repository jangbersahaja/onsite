"use client";

import { authClient } from "@/lib/auth-client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

export type WorkspaceNavigationItem = {
  href: string;
  label: string;
  glyph: string;
  requiredAccess: "clock" | "backoffice";
  count?: number;
};

export type WorkspaceNavigationGroup = {
  label: string;
  items: WorkspaceNavigationItem[];
};

export const managementNavigation: WorkspaceNavigationGroup[] = [
  {
    label: "WORKSPACE",
    items: [
      {
        href: "/clock",
        label: "Clock",
        glyph: "◷",
        requiredAccess: "clock",
      },
    ],
  },
  {
    label: "MANAGE",
    items: [
      {
        href: "/timesheets",
        label: "Timesheets",
        glyph: "▦",
        requiredAccess: "backoffice",
      },
      {
        href: "/corrections/review",
        label: "Review requests",
        glyph: "↗",
        requiredAccess: "backoffice",
      },
      {
        href: "/team",
        label: "Team",
        glyph: "♙",
        requiredAccess: "backoffice",
      },
    ],
  },
];

export type WorkspaceOutlet = {
  id: string;
  name: string;
  role?: string;
};

type WorkspaceShellProps = {
  activeHref: string;
  pageTitle: string;
  workspaceName?: string;
  outlets?: WorkspaceOutlet[];
  selectedOutletId?: string;
  onOutletChange?: (outletId: string) => void;
  isOutletLocked?: boolean;
  dateLabel?: string;
  navigation: WorkspaceNavigationGroup[];
  children: ReactNode;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function WorkspaceShell({
  activeHref,
  pageTitle,
  workspaceName = "Workspace",
  outlets = [],
  selectedOutletId,
  onOutletChange,
  isOutletLocked = false,
  dateLabel,
  navigation,
  children,
}: WorkspaceShellProps) {
  const router = useRouter();
  const session = authClient.useSession();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const userName = session.data?.user.name ?? "Account";
  const selectedOutlet = outlets.find(
    (outlet) => outlet.id === selectedOutletId,
  );
  const visibleNavigation = navigation
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        item.requiredAccess === "clock"
          ? session.data?.user.canAccessClock === true
          : session.data?.user.canAccessBackoffice === true,
      ),
    }))
    .filter((group) => group.items.length > 0);
  const mobileStaffNavigation = visibleNavigation
    .flatMap((group) => group.items)
    .filter((item) => item.requiredAccess === "clock");

  useEffect(() => {
    if (!isMobileNavOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMobileNavOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobileNavOpen]);

  return (
    <div className="workspace-shell">
      {isMobileNavOpen && (
        <button
          className="mobile-nav-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}
      <aside
        className={`side-rail${isMobileNavOpen ? " is-open" : ""}`}
        id="workspace-navigation"
      >
        <Link className="brand-lockup" href="/" aria-label="OnSITE home">
          <Image
            className="brand-mark"
            src="/onsite%20logo.png"
            alt=""
            width={128}
            height={128}
          />
          <span>OnSITE</span>
        </Link>

        <p className="workspace-label">WORKSPACE</p>
        {outlets.length > 0 && selectedOutletId && onOutletChange ? (
          <label className="outlet-switcher" htmlFor="workspace-outlet-select">
            <span className="outlet-avatar">
              {selectedOutlet?.name.slice(0, 1) ?? "O"}
            </span>
            <span className="outlet-copy">
              <strong>{selectedOutlet?.name ?? workspaceName}</strong>
              <small>{selectedOutlet?.role ?? workspaceName}</small>
            </span>
            <select
              id="workspace-outlet-select"
              aria-label="Select outlet"
              value={selectedOutletId}
              onChange={(event) => onOutletChange(event.target.value)}
              disabled={isOutletLocked}
            >
              {outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="outlet-switcher workspace-context">
            <span className="outlet-avatar">
              {workspaceName.slice(0, 1).toUpperCase()}
            </span>
            <span className="outlet-copy">
              <strong>{selectedOutlet?.name ?? workspaceName}</strong>
              <small>{selectedOutlet?.role ?? "Current workspace"}</small>
            </span>
          </div>
        )}

        <nav className="primary-nav" aria-label="Main navigation">
          {visibleNavigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{group.label}</p>
              {group.items.map((item) => (
                <Link
                  className={`nav-item${item.href === activeHref ? " is-active" : ""}`}
                  href={item.href}
                  key={item.href}
                  aria-current={item.href === activeHref ? "page" : undefined}
                  onClick={() => setIsMobileNavOpen(false)}
                >
                  <span className="nav-glyph" aria-hidden="true">
                    {item.glyph}
                  </span>
                  {item.label}
                  {Boolean(item.count) && (
                    <span className="nav-count">{item.count}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail-bottom">
          <div className="demo-status">
            <span className="status-dot" />
            Connected workspace
          </div>
          <button
            className="profile-button"
            type="button"
            onClick={async () => {
              await authClient.signOut();
              router.replace("/");
            }}
          >
            <span className="profile-avatar">{initials(userName)}</span>
            <span className="profile-copy">
              <strong>{userName}</strong>
              <small>Sign out</small>
            </span>
            <span className="switcher-chevron" aria-hidden="true">
              ···
            </span>
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="top-bar">
          <button
            className="mobile-nav-toggle"
            type="button"
            aria-label={
              isMobileNavOpen ? "Close navigation" : "Open navigation"
            }
            aria-expanded={isMobileNavOpen}
            aria-controls="workspace-navigation"
            onClick={() => setIsMobileNavOpen((isOpen) => !isOpen)}
          >
            <span aria-hidden="true">{isMobileNavOpen ? "×" : "☰"}</span>
          </button>
          <div className="breadcrumbs">
            <span>{selectedOutlet?.name ?? workspaceName}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{pageTitle}</strong>
          </div>
          <div className="top-actions">
            {dateLabel && <span className="today-label">{dateLabel}</span>}
            <span className="top-avatar">{initials(userName)}</span>
          </div>
        </header>
        {children}
        {mobileStaffNavigation.some(
          (item) => item.href === "/clock/history",
        ) && (
          <nav className="mobile-staff-tabs" aria-label="Staff navigation">
            {mobileStaffNavigation.map((item) => (
              <Link
                className={`mobile-staff-tab${item.href === activeHref ? " is-active" : ""}`}
                href={item.href}
                key={item.href}
                aria-current={item.href === activeHref ? "page" : undefined}
              >
                <span className="mobile-staff-tab-glyph" aria-hidden="true">
                  {item.glyph}
                </span>
                <span>{item.label}</span>
                {Boolean(item.count) && (
                  <span className="mobile-staff-tab-count">{item.count}</span>
                )}
              </Link>
            ))}
          </nav>
        )}
      </section>
    </div>
  );
}
