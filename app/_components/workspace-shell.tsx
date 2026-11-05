"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { useLocale } from "@/app/_components/locale-provider";
import { OutletAvatar } from "@/app/_components/outlet-avatar";
import { authClient } from "@/lib/auth-client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

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

function subscribeToNothing() {
  return () => {};
}

function isIosBrowserOutsideApp() {
  const isIos =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return isIos && !isStandalone;
}

export type WorkspaceOutlet = {
  id: string;
  name: string;
  imageUrl?: string | null;
};

export function createManagementNavigation(
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
        {
          href: "/activity",
          label: "Activity",
          glyph: "≡",
          requiredAccess: "backoffice",
        },
      ],
    },
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

async function fetchReviewRows(
  url: string,
): Promise<{ outletId?: string }[] | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { requests?: unknown };
    return Array.isArray(body.requests) ? body.requests : null;
  } catch {
    return null;
  }
}

export function WorkspaceShell({
  activeHref,
  pageTitle,
  workspaceName: workspaceNameProp,
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
  const { confirm, confirmDialog } = useConfirmDialog();
  const { messages } = useLocale();
  const workspaceName = workspaceNameProp ?? messages.shell.workspace;
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [pendingDeviceRequestCount, setPendingDeviceRequestCount] = useState(0);
  const [pendingCorrectionCount, setPendingCorrectionCount] = useState(0);
  const [pendingManualShiftCount, setPendingManualShiftCount] = useState(0);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(
    null,
  );
  const isIosBrowser = useSyncExternalStore(
    subscribeToNothing,
    isIosBrowserOutsideApp,
    () => false,
  );
  const [showIosHint, setShowIosHint] = useState(false);
  const canAccessBackoffice = session.data?.user.canAccessBackoffice === true;
  const userName = session.data?.user.name ?? messages.shell.account;
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
        .map((item) => {
          if (item.href === "/corrections/review")
            return {
              ...item,
              count:
                pendingDeviceRequestCount +
                pendingCorrectionCount +
                pendingManualShiftCount,
            };
          return item;
        }),
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
      const [devices, corrections, manualShifts] = await Promise.all([
        fetchReviewRows("/api/staff-devices?view=review"),
        fetchReviewRows("/api/corrections?view=review"),
        fetchReviewRows("/api/manual-shifts?view=review"),
      ]);
      if (!active || generation !== refreshGeneration) return;
      if (devices) setPendingDeviceRequestCount(devices.length);
      if (corrections) setPendingCorrectionCount(corrections.length);
      if (manualShifts) setPendingManualShiftCount(manualShifts.length);
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

  async function signOut() {
    if (
      !(await confirm({
        title: messages.shell.signOutTitle,
        description: messages.shell.signOutDescription,
        confirmLabel: messages.shell.signOut,
      }))
    )
      return;
    await authClient.signOut();
    router.replace("/");
  }

  return (
    <div className="workspace-shell">
      {isMobileNavOpen && (
        <button
          className="mobile-nav-backdrop"
          type="button"
          aria-label={messages.shell.closeNavigation}
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}
      <aside
        className={`side-rail${isMobileNavOpen ? " is-open" : ""}`}
        id="workspace-navigation"
      >
        <Link
          className="brand-lockup"
          href="/"
          aria-label={messages.shell.homeLabel}
        >
          <Image
            className="brand-mark"
            src="/onsite%20logo.png"
            alt=""
            width={128}
            height={128}
            priority
          />
          <span>OnSITE</span>
        </Link>

        <p className="workspace-label">{messages.shell.workspaceLabel}</p>
        {outlets.length > 0 && selectedOutletId && onOutletChange ? (
          <label className="outlet-switcher" htmlFor="workspace-outlet-select">
            <OutletAvatar
              name={selectedOutlet?.name ?? "O"}
              imageUrl={selectedOutlet?.imageUrl}
              fallback={selectedOutlet?.name.slice(0, 1) ?? "O"}
            />
            <span className="outlet-copy">
              <strong>{selectedOutlet?.name ?? workspaceName}</strong>
              <small>{workspaceName}</small>
            </span>
            <select
              id="workspace-outlet-select"
              aria-label={messages.shell.selectOutlet}
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
            <OutletAvatar
              name={workspaceName}
              imageUrl={selectedOutlet?.imageUrl}
              fallback={workspaceName.slice(0, 1).toUpperCase()}
            />
            <span className="outlet-copy">
              <strong>{selectedOutlet?.name ?? workspaceName}</strong>
              <small>{messages.shell.currentWorkspace}</small>
            </span>
          </div>
        )}

        <nav className="primary-nav" aria-label={messages.shell.mainNavigation}>
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
                      ⌄
                    </span>
                  </button>
                ) : (
                  <p className="nav-group-label">{group.label}</p>
                )}
                <div id={`nav-group-items-${groupIndex}`} hidden={!isExpanded}>
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
              </div>
            );
          })}
        </nav>

        <div className="rail-bottom">
          <div className="demo-status">
            <span className="status-dot" />
            {messages.shell.connectedWorkspace}
          </div>
          <div className="profile-account" ref={accountMenuRef}>
            <button
              className="profile-button"
              type="button"
              aria-expanded={isAccountMenuOpen}
              aria-controls="profile-account-menu"
              onClick={() => setIsAccountMenuOpen((isOpen) => !isOpen)}
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
                <small>{messages.shell.manageAccount}</small>
              </span>
              <span className="switcher-chevron" aria-hidden="true">
                ···
              </span>
            </button>
            {isAccountMenuOpen && (
              <div className="profile-menu" id="profile-account-menu">
                <Link
                  className="btn btn-secondary btn-block"
                  href="/profile"
                  onClick={() => setIsAccountMenuOpen(false)}
                >
                  {messages.profile.title}
                </Link>
                <button
                  className="btn btn-danger btn-block"
                  type="button"
                  onClick={() => void signOut()}
                >
                  {messages.shell.signOut}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="top-bar">
          <button
            className="btn btn-ghost btn-icon mobile-nav-toggle"
            type="button"
            aria-label={
              isMobileNavOpen
                ? messages.shell.closeNavigation
                : messages.shell.openNavigation
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
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => void installApp()}
              >
                {messages.shell.installApp}
              </button>
            )}
            {isIosBrowser && (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                aria-expanded={showIosHint}
                onClick={() => setShowIosHint((value) => !value)}
              >
                {messages.shell.installApp}
              </button>
            )}
            {isIosBrowser && showIosHint && (
              <span className="today-label" role="status">
                {messages.shell.iosInstallHint}
              </span>
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
          <nav
            className="mobile-staff-tabs"
            aria-label={messages.shell.staffNavigation}
          >
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
      {confirmDialog}
    </div>
  );
}
