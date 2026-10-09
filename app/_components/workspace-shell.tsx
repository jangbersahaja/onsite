"use client";

import { authClient } from "@/lib/auth-client";
import { MAX_PROFILE_PHOTO_BYTES } from "@/lib/profile-photo";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

export type WorkspaceNavigationItem = {
  href: string;
  label: string;
  glyph: string;
  requiredAccess: "clock" | "backoffice";
  count?: number;
};

export type WorkspaceNavigationGroup = {
  id?: string;
  label: string;
  items: WorkspaceNavigationItem[];
  collapsible?: boolean;
};

export const REVIEW_REQUESTS_CHANGED_EVENT = "review-requests-changed";

export type WorkspaceOutlet = {
  id: string;
  name: string;
  role?: string;
};

export function createManagementNavigation(
  outlets: WorkspaceOutlet[] = [],
  canManageOutlets = false,
): WorkspaceNavigationGroup[] {
  return [
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
          href: "/manage",
          label: "Dashboard",
          glyph: "⌂",
          requiredAccess: "backoffice",
        },
        ...(canManageOutlets
          ? [
              {
                href: "/outlets",
                label: "Outlets",
                glyph: "⌖",
                requiredAccess: "backoffice" as const,
              },
            ]
          : []),
        {
          href: "/device-requests",
          label: "Device requests",
          glyph: "▣",
          requiredAccess: "backoffice",
        },
      ],
    },
    ...outlets.map((outlet) => ({
      id: `outlet:${outlet.id}`,
      label: outlet.name,
      collapsible: true,
      items: [
        {
          href: `/outlets/${outlet.id}/timesheets`,
          label: "Timesheets",
          glyph: "▦",
          requiredAccess: "backoffice" as const,
        },
        {
          href: `/outlets/${outlet.id}/corrections/review`,
          label: "Review requests",
          glyph: "↗",
          requiredAccess: "backoffice" as const,
        },
        {
          href: `/outlets/${outlet.id}/team`,
          label: "Team",
          glyph: "♙",
          requiredAccess: "backoffice" as const,
        },
      ],
    })),
  ];
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
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
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [expandedNavigationGroups, setExpandedNavigationGroups] = useState<
    Set<string>
  >(() => new Set());
  const [profilePhotoMessage, setProfilePhotoMessage] = useState("");
  const [isPhotoSaving, setIsPhotoSaving] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const profilePhotoInputRef = useRef<HTMLInputElement>(null);
  const [pendingDeviceRequestCount, setPendingDeviceRequestCount] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const canAccessBackoffice = session.data?.user.canAccessBackoffice === true;
  const userName = session.data?.user.name ?? "Account";
  const profilePhotoUrl = session.data?.user.profilePhotoUrl ?? null;
  const selectedOutlet = outlets.find(
    (outlet) => outlet.id === selectedOutletId,
  );
  const visibleNavigation = navigation
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) =>
          item.requiredAccess === "clock"
            ? session.data?.user.canAccessClock === true
            : session.data?.user.canAccessBackoffice === true,
        )
        .map((item) =>
          item.href === "/device-requests"
            ? { ...item, count: pendingDeviceRequestCount }
            : item,
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

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !accountMenuRef.current?.contains(event.target)
      ) {
        setIsAccountMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsAccountMenuOpen(false);
    }
    window.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAccountMenuOpen]);

  useEffect(() => {
    if (!canAccessBackoffice) return;

    let active = true;
    let refreshGeneration = 0;
    async function refreshReviewCount() {
      const generation = ++refreshGeneration;
      try {
        const deviceResponse = await fetch("/api/staff-devices?view=review", {
          cache: "no-store",
        });
        if (!deviceResponse.ok) return;
        const deviceBody = (await deviceResponse.json()) as {
          requests?: unknown;
        };
        if (!Array.isArray(deviceBody.requests)) return;

        if (active && generation === refreshGeneration) {
          setPendingDeviceRequestCount(deviceBody.requests.length);
        }
      } catch {
        // Keep the last known count when a background refresh fails.
      }
    }

    function onReviewRequestsChanged() {
      void refreshReviewCount();
    }

    function onReviewDecision() {
      void refreshReviewCount();
    }

    void refreshReviewCount();
    const interval = window.setInterval(onReviewRequestsChanged, 60_000);
    window.addEventListener("focus", onReviewRequestsChanged);
    window.addEventListener(REVIEW_REQUESTS_CHANGED_EVENT, onReviewDecision);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onReviewRequestsChanged);
      window.removeEventListener(
        REVIEW_REQUESTS_CHANGED_EVENT,
        onReviewDecision,
      );
    };
  }, [canAccessBackoffice]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    function onBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  async function updateProfilePhoto(file: File) {
    setProfilePhotoMessage("");
    if (file.size > MAX_PROFILE_PHOTO_BYTES) {
      setProfilePhotoMessage("Profile photos must be 2 MB or smaller.");
      return;
    }

    setIsPhotoSaving(true);
    try {
      const form = new FormData();
      form.set("photo", file);
      const response = await fetch("/api/profile-photo", {
        method: "POST",
        body: form,
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not update profile photo.");
      }
      window.dispatchEvent(new Event("shiftline-session-changed"));
      setIsAccountMenuOpen(false);
    } catch (error) {
      setProfilePhotoMessage(
        error instanceof Error
          ? error.message
          : "Could not update profile photo.",
      );
    } finally {
      setIsPhotoSaving(false);
    }
  }

  async function removeProfilePhoto() {
    setProfilePhotoMessage("");
    setIsPhotoSaving(true);
    try {
      const response = await fetch("/api/profile-photo", { method: "DELETE" });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Could not remove profile photo.");
      }
      window.dispatchEvent(new Event("shiftline-session-changed"));
      setIsAccountMenuOpen(false);
    } catch (error) {
      setProfilePhotoMessage(
        error instanceof Error
          ? error.message
          : "Could not remove profile photo.",
      );
    } finally {
      setIsPhotoSaving(false);
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/");
  }

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
          {visibleNavigation.map((group, groupIndex) => {
            const groupId = group.id ?? group.label;
            const isActiveGroup = group.items.some(
              (item) => item.href === activeHref,
            );
            const isExpanded =
              !group.collapsible ||
              isActiveGroup ||
              expandedNavigationGroups.has(groupId);

            return (
              <div className="nav-group" key={groupId}>
                {group.collapsible ? (
                  <button
                    className="nav-group-toggle"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`nav-group-items-${groupIndex}`}
                    onClick={() =>
                      setExpandedNavigationGroups((current) => {
                        const next = new Set(current);
                        if (next.has(groupId)) next.delete(groupId);
                        else next.add(groupId);
                        return next;
                      })
                    }
                  >
                    <span className="nav-group-label">{group.label}</span>
                    <span className="nav-group-chevron" aria-hidden="true">
                      {isExpanded ? "⌄" : "›"}
                    </span>
                  </button>
                ) : (
                  <p className="nav-group-label">{group.label}</p>
                )}
                {isExpanded && (
                  <div id={`nav-group-items-${groupIndex}`}>
                    {group.items.map((item) => (
                      <Link
                        className={`nav-item${item.href === activeHref ? " is-active" : ""}`}
                        href={item.href}
                        key={item.href}
                        aria-current={
                          item.href === activeHref ? "page" : undefined
                        }
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
                )}
              </div>
            );
          })}
        </nav>

        <div className="rail-bottom">
          <div className="demo-status">
            <span className="status-dot" />
            Connected workspace
          </div>
          <div className="profile-account" ref={accountMenuRef}>
            <button
              className="profile-button"
              type="button"
              aria-expanded={isAccountMenuOpen}
              aria-controls="profile-account-menu"
              onClick={() => {
                setProfilePhotoMessage("");
                setIsAccountMenuOpen((isOpen) => !isOpen);
              }}
            >
              {profilePhotoUrl ? (
                <Image
                  className="profile-avatar profile-avatar-photo"
                  src={profilePhotoUrl}
                  alt=""
                  width={33}
                  height={33}
                  unoptimized
                />
              ) : (
                <span className="profile-avatar">{initials(userName)}</span>
              )}
              <span className="profile-copy">
                <strong>{userName}</strong>
                <small>Manage account</small>
              </span>
              <span className="switcher-chevron" aria-hidden="true">
                ···
              </span>
            </button>
            {isAccountMenuOpen && (
              <div className="profile-menu" id="profile-account-menu">
                <input
                  ref={profilePhotoInputRef}
                  type="file"
                  hidden
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Choose a profile photo"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void updateProfilePhoto(file);
                  }}
                />
                <button
                  type="button"
                  disabled={isPhotoSaving}
                  onClick={() => profilePhotoInputRef.current?.click()}
                >
                  Change photo
                </button>
                {profilePhotoUrl && (
                  <button
                    type="button"
                    disabled={isPhotoSaving}
                    onClick={() => void removeProfilePhoto()}
                  >
                    Remove photo
                  </button>
                )}
                {profilePhotoMessage && (
                  <p className="profile-menu-message" role="status">
                    {profilePhotoMessage}
                  </p>
                )}
                <button
                  className="profile-menu-signout"
                  type="button"
                  disabled={isPhotoSaving}
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
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
            {installPrompt && (
              <button
                className="install-app-button"
                type="button"
                onClick={() => void installApp()}
              >
                Install app
              </button>
            )}
            {profilePhotoUrl ? (
              <Image
                className="top-avatar top-avatar-photo"
                src={profilePhotoUrl}
                alt=""
                width={33}
                height={33}
                unoptimized
              />
            ) : (
              <span className="top-avatar">{initials(userName)}</span>
            )}
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
