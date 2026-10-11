"use client";

import { NotificationSettings } from "@/app/(management)/team/_components/notification-settings";
import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { ModalDialog } from "@/app/_components/modal-dialog";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type TeamMember = {
  userId: string;
  name: string;
  email: string;
  username: string;
  accountType: "super_admin" | "user";
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
  canManageAccess: boolean;
  outletId: string;
  outletName: string;
  canReset: boolean;
  profilePhotoUrl: string | null;
};

type TeamPerson = {
  userId: string;
  name: string;
  email: string;
  profilePhotoUrl: string | null;
  assignments: TeamMember[];
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
  canManageAccess: boolean;
  canReset: boolean;
  pendingDevice: StaffDevice | undefined;
  activeDevice: StaffDevice | undefined;
};

type PendingRegistration = {
  id: string;
  name: string;
  username: string;
  email: string;
  requestedAt: string;
  outletId: string | null;
  outletName: string | null;
  photoUrl: string;
};

type RegistrationLinkOutlet = {
  outletId: string;
  outletName: string;
  link: { id: string; url: string; createdAt: string } | null;
};

type TeamOutlet = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
};

type StaffDevice = {
  id: string;
  userId: string;
  status: "pending" | "active";
  deviceName: string | null;
  createdAt: string;
  approvedAt: string | null;
};

type TeamData = {
  isSuperAdmin: boolean;
  outlets: TeamOutlet[];
  members: TeamMember[];
  staffDevices: StaffDevice[];
};

async function loadTeamData(outletId?: string) {
  const query = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
  const response = await fetch(`/api/team${query}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load team data.");
  return body as TeamData;
}

async function loadRegistrations() {
  const response = await fetch("/api/registrations", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not load registrations.");
  return body.requests as PendingRegistration[];
}

async function loadRegistrationLinks() {
  const response = await fetch("/api/registration-links", {
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error ?? "Could not load registration links.");
  return body.outlets as RegistrationLinkOutlet[];
}

function RegistrationQr({ url, label }: { url: string; label: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { margin: 1, width: 240 })
      .then((dataUrl) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setSrc("");
      });
    return () => {
      active = false;
    };
  }, [url]);

  if (!src) {
    return (
      <span className="registration-qr-placeholder" aria-hidden="true">
        QR
      </span>
    );
  }

  return (
    <Image
      className="registration-qr"
      src={src}
      alt={`QR code for ${label}`}
      width={240}
      height={240}
      unoptimized
    />
  );
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last =
    parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

function TeamAvatar({
  name,
  photoUrl,
}: {
  name: string;
  photoUrl: string | null;
}) {
  return photoUrl ? (
    <Image
      className="team-avatar team-avatar-photo"
      src={photoUrl}
      alt=""
      width={36}
      height={36}
      unoptimized
    />
  ) : (
    <span className="team-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function TeamCardMenuButton({
  name,
  onOpen,
}: {
  name: string;
  onOpen: () => void;
}) {
  return (
    <button
      className="team-card-menu"
      type="button"
      aria-label={`Actions for ${name}`}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="currentColor"
      >
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
      </svg>
    </button>
  );
}

function deviceStatusLabel(person: TeamPerson) {
  if (!person.canAccessClock) return "Not required";
  if (person.pendingDevice)
    return person.activeDevice
      ? "Replacement awaiting approval"
      : "Awaiting approval";
  return person.activeDevice
    ? (person.activeDevice.deviceName ?? "Unknown device")
    : "Not enrolled";
}

type TeamView = "people" | "approvals" | "registration";

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedOutletId, setSelectedOutletId] = useState("");
  const outletId = selectedOutletId || undefined;
  const [pendingRegistrations, setPendingRegistrations] = useState<
    PendingRegistration[]
  >([]);
  const [registrationOutlets, setRegistrationOutlets] = useState<
    RegistrationLinkOutlet[]
  >([]);
  const [registrationBusyKey, setRegistrationBusyKey] = useState("");
  const [issuedResetLink, setIssuedResetLink] = useState("");
  const [message, setMessage] = useState("");
  const [resettingUserId, setResettingUserId] = useState("");
  const [resetUserId, setResetUserId] = useState("");
  const [deviceActionId, setDeviceActionId] = useState("");
  const [permissionUserId, setPermissionUserId] = useState("");
  const [activeTeamView, setActiveTeamView] = useState<TeamView>("people");
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadTeamData(outletId)
      .then((team) => {
        if (!active) return;
        setData(team);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load team data.",
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [outletId]);

  useEffect(() => {
    let active = true;
    loadRegistrations()
      .then((requests) => {
        if (active) setPendingRegistrations(requests);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load registrations.",
          );
      });
    loadRegistrationLinks()
      .then((outletLinks) => {
        if (active) setRegistrationOutlets(outletLinks);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Could not load registration links.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const { confirm, confirmDialog } = useConfirmDialog();

  async function refreshRegistrations() {
    const [requests, outletLinks] = await Promise.all([
      loadRegistrations(),
      loadRegistrationLinks(),
    ]);
    setPendingRegistrations(requests);
    setRegistrationOutlets(outletLinks);
  }

  async function handleCreateLink(targetOutletId: string, rotate: boolean) {
    if (registrationBusyKey) return;
    if (
      rotate &&
      !(await confirm({
        title: "Replace registration link?",
        description:
          "The current link and QR code will stop working straight away.",
        confirmLabel: "Replace link",
        tone: "danger",
      }))
    )
      return;
    setRegistrationBusyKey(`outlet:${targetOutletId}`);
    setMessage("");
    try {
      const response = await fetch("/api/registration-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outletId: targetOutletId, rotate }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Could not create registration link.");
      await refreshRegistrations();
      setMessage(
        rotate ? "Registration link replaced." : "Registration link created.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not create registration link.",
      );
    } finally {
      setRegistrationBusyKey("");
    }
  }

  async function handleAccessChange(
    person: TeamPerson,
    permission: "canAccessClock" | "canAccessBackoffice",
    enabled: boolean,
  ) {
    if (permissionUserId) return;
    const accessLabel =
      permission === "canAccessClock" ? "Clock access" : "Backoffice access";
    if (
      !(await confirm({
        title: enabled
          ? `Grant ${accessLabel} to ${person.name}?`
          : `Remove ${accessLabel} from ${person.name}?`,
        description: enabled
          ? "They will be able to use this area of the app."
          : "They will lose access to this area of the app.",
        confirmLabel: enabled ? "Grant access" : "Remove access",
        tone: enabled ? "default" : "danger",
      }))
    )
      return;
    setPermissionUserId(person.userId);
    setMessage("");
    try {
      const response = await fetch("/api/team/access", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: person.userId,
          canAccessClock:
            permission === "canAccessClock" ? enabled : person.canAccessClock,
          canAccessBackoffice:
            permission === "canAccessBackoffice"
              ? enabled
              : person.canAccessBackoffice,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update app access.");
      setData(await loadTeamData(outletId));
      setMessage(`App access updated for ${person.name}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update app access.",
      );
      setData(await loadTeamData(outletId));
    } finally {
      setPermissionUserId("");
    }
  }

  async function handleReset(userId: string, memberEmail: string) {
    if (resettingUserId) return;
    setResettingUserId(userId);
    setIssuedResetLink("");
    setMessage("");
    try {
      const response = await fetch("/api/team/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not create reset link.");
      setIssuedResetLink(body.resetUrl);
      setMessage(`One-time password reset link created for ${memberEmail}.`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create reset link.",
      );
    } finally {
      setResettingUserId("");
    }
  }

  async function handleStaffDeviceAction(deviceId: string, action: "revoke") {
    if (deviceActionId) return;
    if (
      !(await confirm({
        title: "Revoke device?",
        description: "This device will no longer be trusted for clocking in.",
        confirmLabel: "Revoke device",
        tone: "danger",
      }))
    )
      return;
    setDeviceActionId(deviceId);
    setMessage("");
    try {
      const response = await fetch(`/api/staff-devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update trusted device.");
      setData(await loadTeamData(outletId));
      setMessage("Staff device revoked.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update trusted device.",
      );
    } finally {
      setDeviceActionId("");
    }
  }

  async function handleRevokeLink(linkId: string) {
    if (registrationBusyKey) return;
    if (
      !(await confirm({
        title: "Revoke registration link?",
        description:
          "Anyone with this link or QR code will no longer be able to register.",
        confirmLabel: "Revoke link",
        tone: "danger",
      }))
    )
      return;
    setRegistrationBusyKey(`link:${linkId}`);
    setMessage("");
    try {
      const response = await fetch(`/api/registration-links/${linkId}`, {
        method: "DELETE",
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Could not revoke registration link.");
      await refreshRegistrations();
      setMessage("Registration link revoked.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not revoke registration link.",
      );
    } finally {
      setRegistrationBusyKey("");
    }
  }

  async function handleRegistrationDecision(
    registration: PendingRegistration,
    action: "approve" | "reject",
  ) {
    if (registrationBusyKey) return;
    const approving = action === "approve";
    if (
      !(await confirm({
        title: approving
          ? `Approve ${registration.name}?`
          : `Reject ${registration.name}?`,
        description: approving
          ? "They will get clock access to this outlet and their device will be approved."
          : "Their registration will be removed.",
        confirmLabel: approving ? "Approve" : "Reject",
        tone: approving ? "default" : "danger",
      }))
    )
      return;
    setRegistrationBusyKey(`reg:${registration.id}:${action}`);
    setMessage("");
    try {
      const response = await fetch(`/api/registrations/${registration.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Could not update registration.");
      await refreshRegistrations();
      setData(await loadTeamData(outletId));
      setMessage(
        approving
          ? `${registration.name} approved.`
          : `Registration from ${registration.name} rejected.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not update registration.",
      );
    } finally {
      setRegistrationBusyKey("");
    }
  }

  async function copyRegistrationLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setMessage("Registration link copied.");
    } catch {
      setMessage("Copy failed. Select and copy the registration link.");
    }
  }

  async function copyResetLink() {
    try {
      await navigator.clipboard.writeText(issuedResetLink);
      setMessage("Password reset link copied.");
    } catch {
      setMessage("Copy failed. Select and copy the password reset link.");
    }
  }

  if (isLoading) {
    return (
      <main className="loading-screen" aria-live="polite">
        Loading team…
      </main>
    );
  }

  if (!data) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <p className="eyebrow">TEAM ACCESS</p>
          <h1>Team management</h1>
          <p className="auth-description">
            {message || "Sign in with a backoffice account."}
          </p>
          <Link className="auth-submit invite-link-button" href="/">
            Return to clock
          </Link>
        </section>
      </main>
    );
  }

  const peopleById = new Map<string, TeamPerson>();
  for (const member of data.members) {
    const person = peopleById.get(member.userId);
    if (person) {
      person.assignments.push(member);
      person.canReset ||= member.canReset;
      person.canManageAccess ||= member.canManageAccess;
    } else {
      const devices = data.staffDevices.filter(
        (device) => device.userId === member.userId,
      );
      peopleById.set(member.userId, {
        userId: member.userId,
        name: member.name,
        email: member.email,
        profilePhotoUrl: member.profilePhotoUrl,
        assignments: [member],
        canAccessClock: member.canAccessClock,
        canAccessBackoffice: member.canAccessBackoffice,
        canManageAccess: member.canManageAccess,
        canReset: member.canReset,
        pendingDevice: devices.find((device) => device.status === "pending"),
        activeDevice: devices.find((device) => device.status === "active"),
      });
    }
  }
  const visiblePeople = Array.from(peopleById.values());
  visiblePeople.sort((left, right) => left.name.localeCompare(right.name));
  const resetPerson = visiblePeople.find(
    (person) => person.userId === resetUserId,
  );
  const pendingDeviceCount = data.staffDevices.filter(
    (device) => device.status === "pending",
  ).length;
  const actionPerson = visiblePeople.find(
    (person) => person.userId === openActionMenu,
  );
  const actionPending = actionPerson?.pendingDevice;
  const actionActive = actionPerson?.activeDevice;
  const visiblePendingRegistrations = pendingRegistrations.filter(
    (registration) => !outletId || registration.outletId === outletId,
  );
  const visibleRegistrationOutlets = registrationOutlets.filter(
    (outlet) => !outletId || outlet.outletId === outletId,
  );
  const visibleTeamViews: { id: TeamView; label: string; count?: number }[] = [
    { id: "people", label: "People", count: pendingDeviceCount },
    {
      id: "approvals",
      label: "Approvals",
      count: visiblePendingRegistrations.length,
    },
    { id: "registration", label: "Registration" },
  ];

  return (
    <div className="team-page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {data.isSuperAdmin ? "SUPER ADMIN" : "BACKOFFICE ACCESS"}
          </p>
          <h1>Team</h1>
          <p className="subheading">
            {outletId
              ? "Manage people, registrations, and clock-in access for this outlet."
              : "Manage people and access across all your outlets."}
          </p>
        </div>
        {data.outlets.length > 0 && (
          <label className="team-outlet-filter">
            <span>Outlet</span>
            <select
              value={selectedOutletId}
              onChange={(event) => setSelectedOutletId(event.target.value)}
            >
              <option value="">All managed outlets</option>
              {data.outlets.map((outlet) => (
                <option key={outlet.id} value={outlet.id}>
                  {outlet.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {message && (
        <p className="team-message" role="status" aria-live="polite">
          {message}
        </p>
      )}

      {outletId && <NotificationSettings outletId={outletId} />}

      {visibleTeamViews.length > 0 && (
        <nav className="team-view-nav" aria-label="Team sections">
          {visibleTeamViews.map((view) => (
            <button
              className={`team-view-tab${activeTeamView === view.id ? " is-active" : ""}`}
              type="button"
              key={view.id}
              aria-current={activeTeamView === view.id ? "page" : undefined}
              onClick={() => setActiveTeamView(view.id)}
            >
              {view.label}
              {view.count ? <span>{view.count}</span> : null}
            </button>
          ))}
        </nav>
      )}

      <ModalDialog
        open={Boolean(actionPerson)}
        onOpenChange={(open) => {
          if (!open) setOpenActionMenu(null);
        }}
        labelledBy="team-action-title"
      >
        {actionPerson && (
          <div className="dialog-panel">
            <header className="dialog-header">
              <div className="team-action-heading">
                <TeamAvatar
                  name={actionPerson.name}
                  photoUrl={actionPerson.profilePhotoUrl}
                />
                <div>
                  <p className="eyebrow">PERSON</p>
                  <h2 id="team-action-title">{actionPerson.name}</h2>
                </div>
              </div>
              <button
                className="dialog-close"
                type="button"
                aria-label="Close dialog"
                onClick={() => setOpenActionMenu(null)}
              >
                ×
              </button>
            </header>
            <div className="team-action-list">
              {actionPerson?.canReset && (
                <button
                  className="team-action-item"
                  type="button"
                  onClick={() => {
                    setOpenActionMenu(null);
                    setResetUserId(actionPerson.userId);
                  }}
                >
                  Reset password
                </button>
              )}
              {actionPending && (
                <Link
                  className="team-action-item"
                  href="/corrections/review"
                  onClick={() => setOpenActionMenu(null)}
                >
                  Review request
                </Link>
              )}
              {actionActive && (
                <button
                  className="team-action-item is-danger"
                  type="button"
                  disabled={Boolean(deviceActionId)}
                  onClick={async () => {
                    await handleStaffDeviceAction(actionActive.id, "revoke");
                    setOpenActionMenu(null);
                  }}
                >
                  {deviceActionId === actionActive.id
                    ? "Saving…"
                    : "Revoke device"}
                </button>
              )}
            </div>
          </div>
        )}
      </ModalDialog>

      {confirmDialog}

      <ModalDialog
        open={Boolean(resetPerson)}
        onOpenChange={(open) => {
          if (!open) setResetUserId("");
        }}
        labelledBy="reset-password-title"
      >
        {resetPerson && (
          <div className="dialog-panel">
            <header className="dialog-header">
              <div>
                <p className="eyebrow">ACCOUNT ACCESS</p>
                <h2 id="reset-password-title">Reset password</h2>
              </div>
              <button
                className="dialog-close"
                type="button"
                aria-label="Close dialog"
                onClick={() => setResetUserId("")}
              >
                ×
              </button>
            </header>
            <p className="dialog-description">
              Create a one-time link for {resetPerson.email}. It works once and
              expires after 30 minutes.
            </p>
            <div className="dialog-actions">
              <button
                className="reset-link-button"
                type="button"
                disabled={Boolean(resettingUserId)}
                onClick={async () => {
                  await handleReset(resetPerson.userId, resetPerson.email);
                  setResetUserId("");
                }}
              >
                {resettingUserId === resetPerson.userId
                  ? "Creating…"
                  : "Create reset link"}
              </button>
              <button
                className="copy-invite-button"
                type="button"
                onClick={() => setResetUserId("")}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </ModalDialog>

      {activeTeamView === "people" && (
        <section
          className="team-list-section"
          aria-labelledby="team-members-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">TEAM ACCESS</p>
              <h2 id="team-members-title">People</h2>
              <p className="team-section-description">
                Manage people, outlet access, and clock-in devices.
              </p>
            </div>
            <div className="team-heading-actions">
              <span className="team-count">{visiblePeople.length}</span>
            </div>
          </div>
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>OUTLET ACCESS</th>
                  <th>APP ACCESS</th>
                  <th>DEVICE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visiblePeople.map((person) => (
                  <tr key={person.userId}>
                    <td className="team-person-cell">
                      <div className="team-person">
                        <TeamAvatar
                          name={person.name}
                          photoUrl={person.profilePhotoUrl}
                        />
                        <div className="team-person-text">
                          <strong>{person.name}</strong>
                          <small>{person.email}</small>
                        </div>
                      </div>
                      {(person.canReset ||
                        person.pendingDevice ||
                        person.activeDevice) && (
                        <TeamCardMenuButton
                          name={person.name}
                          onOpen={() => setOpenActionMenu(person.userId)}
                        />
                      )}
                    </td>
                    <td
                      className="team-assignment-cell"
                      data-label="Outlet access"
                    >
                      <div className="team-access-list">
                        {person.assignments.map((assignment) => (
                          <div
                            className="team-access-item"
                            key={assignment.outletId}
                          >
                            <span>{assignment.outletName}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td data-label="App access">
                      <div className="team-permission-options">
                        <label>
                          <input
                            type="checkbox"
                            checked={person.canAccessClock}
                            disabled={
                              !person.canManageAccess ||
                              permissionUserId === person.userId ||
                              (person.canAccessClock &&
                                !person.canAccessBackoffice)
                            }
                            onChange={(event) =>
                              void handleAccessChange(
                                person,
                                "canAccessClock",
                                event.target.checked,
                              )
                            }
                          />
                          Clock
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={person.canAccessBackoffice}
                            disabled={
                              !person.canManageAccess ||
                              permissionUserId === person.userId ||
                              (person.canAccessBackoffice &&
                                !person.canAccessClock)
                            }
                            onChange={(event) =>
                              void handleAccessChange(
                                person,
                                "canAccessBackoffice",
                                event.target.checked,
                              )
                            }
                          />
                          Backoffice
                        </label>
                      </div>
                    </td>
                    <td data-label="Device">
                      <div className="device-cell">
                        <div>
                          {deviceStatusLabel(person)}
                          {person.pendingDevice ? (
                            <small>
                              {person.pendingDevice.deviceName ??
                                "Unknown device"}
                              {" · "}
                              {formatExpiry(person.pendingDevice.createdAt)}
                            </small>
                          ) : person.activeDevice?.approvedAt ? (
                            <small>
                              {formatExpiry(person.activeDevice.approvedAt)}
                            </small>
                          ) : null}
                        </div>
                        {person.activeDevice && (
                          <button
                            className="device-revoke-button"
                            type="button"
                            aria-label="Revoke device"
                            title="Revoke device"
                            disabled={Boolean(deviceActionId)}
                            onClick={() =>
                              void handleStaffDeviceAction(
                                person.activeDevice!.id,
                                "revoke",
                              )
                            }
                          >
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 24 24"
                              width="12"
                              height="12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            >
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                    <td data-label="Actions">
                      {person.canReset && (
                        <button
                          className="reset-link-button"
                          type="button"
                          onClick={() => setResetUserId(person.userId)}
                        >
                          Reset password
                        </button>
                      )}
                      {person.pendingDevice && (
                        <Link
                          className="reset-link-button"
                          href="/corrections/review"
                        >
                          Review request
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
                {!visiblePeople.length && (
                  <tr>
                    <td colSpan={5} className="empty-table">
                      No team members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visiblePeople.some(
            (person) => person.pendingDevice && person.activeDevice,
          ) && (
            <p className="auth-description">
              Approving a replacement immediately revokes the previous device.
            </p>
          )}
          {issuedResetLink && (
            <div className="issued-invite">
              <input
                aria-label="Password reset link"
                readOnly
                value={issuedResetLink}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="copy-invite-button"
                type="button"
                onClick={copyResetLink}
              >
                Copy link
              </button>
              <p>
                Share this link directly with the team member. It works once and
                expires after 30 minutes.
              </p>
            </div>
          )}
        </section>
      )}

      {activeTeamView === "approvals" && (
        <section
          className="team-list-section"
          aria-labelledby="pending-registrations-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">REGISTRATION</p>
              <h2 id="pending-registrations-title">Pending approvals</h2>
              <p className="team-section-description">
                Approving grants clock access to the outlet and activates the
                applicant&apos;s device.
              </p>
            </div>
            <span className="team-count">
              {visiblePendingRegistrations.length}
            </span>
          </div>
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>OUTLET</th>
                  <th>REQUESTED</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visiblePendingRegistrations.map((registration) => (
                  <tr key={registration.id}>
                    <td className="team-person-cell">
                      <div className="team-person">
                        <TeamAvatar
                          name={registration.name}
                          photoUrl={registration.photoUrl}
                        />
                        <div className="team-person-text">
                          <strong>{registration.name}</strong>
                          <small>
                            {registration.username} · {registration.email}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Outlet">
                      {registration.outletName ?? "—"}
                    </td>
                    <td data-label="Requested">
                      {formatExpiry(registration.requestedAt)}
                    </td>
                    <td
                      data-label="Actions"
                      className="registration-action-cell"
                    >
                      <div className="registration-actions">
                        <button
                          className="team-primary-action"
                          type="button"
                          disabled={Boolean(registrationBusyKey)}
                          onClick={() =>
                            void handleRegistrationDecision(
                              registration,
                              "approve",
                            )
                          }
                        >
                          {registrationBusyKey ===
                          `reg:${registration.id}:approve`
                            ? "Saving…"
                            : "Approve"}
                        </button>
                        <button
                          className="reset-link-button"
                          type="button"
                          disabled={Boolean(registrationBusyKey)}
                          onClick={() =>
                            void handleRegistrationDecision(
                              registration,
                              "reject",
                            )
                          }
                        >
                          {registrationBusyKey ===
                          `reg:${registration.id}:reject`
                            ? "Saving…"
                            : "Reject"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!visiblePendingRegistrations.length && (
                  <tr>
                    <td colSpan={4} className="empty-table">
                      No pending registrations.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTeamView === "registration" && (
        <section
          className="team-list-section"
          aria-labelledby="registration-links-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">JOIN LINK</p>
              <h2 id="registration-links-title">Registration links</h2>
              <p className="team-section-description">
                Share the QR code or link with a new person. They fill in their
                own details, and a backoffice user for the outlet approves them.
                Links work until revoked.
              </p>
            </div>
          </div>
          <div className="registration-link-list">
            {visibleRegistrationOutlets.map((outlet) => {
              const link = outlet.link;
              const isBusy = registrationBusyKey.length > 0;
              return (
                <article
                  className="registration-link-card"
                  key={outlet.outletId}
                >
                  {link && (
                    <RegistrationQr url={link.url} label={outlet.outletName} />
                  )}
                  <div className="registration-link-details">
                    <strong>{outlet.outletName}</strong>
                    {link ? (
                      <>
                        <input
                          aria-label={`Registration link for ${outlet.outletName}`}
                          readOnly
                          value={link.url}
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <small>Created {formatExpiry(link.createdAt)}</small>
                        <div className="registration-actions">
                          <button
                            className="copy-invite-button"
                            type="button"
                            onClick={() => void copyRegistrationLink(link.url)}
                          >
                            Copy link
                          </button>
                          <button
                            className="reset-link-button"
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleCreateLink(outlet.outletId, true)
                            }
                          >
                            {registrationBusyKey === `outlet:${outlet.outletId}`
                              ? "Saving…"
                              : "Replace link"}
                          </button>
                          <button
                            className="reset-link-button"
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleRevokeLink(link.id)}
                          >
                            {registrationBusyKey === `link:${link.id}`
                              ? "Revoking…"
                              : "Revoke"}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <small>No active registration link.</small>
                        <div className="registration-actions">
                          <button
                            className="team-primary-action"
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void handleCreateLink(outlet.outletId, false)
                            }
                          >
                            {registrationBusyKey === `outlet:${outlet.outletId}`
                              ? "Creating…"
                              : "Create link"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
            {!visibleRegistrationOutlets.length && (
              <p className="auth-description">
                No outlets are available for registration links.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
