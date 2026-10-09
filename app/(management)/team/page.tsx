"use client";

import { ModalDialog } from "@/app/_components/modal-dialog";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

type TeamMember = {
  userId: string;
  name: string;
  email: string;
  username: string;
  accountType: "super_admin" | "admin" | "staff";
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
  canManageAccess: boolean;
  outletId: string;
  outletName: string;
  role: "manager" | "supervisor" | "staff";
  canReset: boolean;
};

type TeamPerson = {
  userId: string;
  name: string;
  email: string;
  assignments: TeamMember[];
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
  canManageAccess: boolean;
  canReset: boolean;
};

type TeamInvitation = {
  id: string;
  email: string;
  accountType: "admin" | "staff";
  canAccessClock: boolean;
  canAccessBackoffice: boolean;
  role: "manager" | "supervisor" | "staff";
  outletIds: string[];
  outletNames: string[];
  expiresAt: string;
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
  createdAt: string;
  approvedAt: string | null;
};

type TeamData = {
  isAdmin: boolean;
  isSuperAdmin: boolean;
  outlets: TeamOutlet[];
  members: TeamMember[];
  invitations: TeamInvitation[];
  managers: { id: string; name: string; email: string }[];
  managerAssignments: { userId: string; outletId: string; isActive: boolean }[];
  staffDevices: StaffDevice[];
};

async function loadTeamData(outletId?: string) {
  const query = outletId ? `?outletId=${encodeURIComponent(outletId)}` : "";
  const response = await fetch(`/api/team${query}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load team data.");
  return body as TeamData;
}

function formatExpiry(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const roleOrder = { manager: 0, supervisor: 1, staff: 2 } as const;
type TeamView = "people" | "invitations" | "devices" | "locations";

export default function TeamPage({
  outletId,
  initialView,
  outletsOnly = false,
}: {
  outletId?: string;
  initialView?: TeamView;
  outletsOnly?: boolean;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [data, setData] = useState<TeamData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInviting, setIsInviting] = useState(false);
  const [isCreatingOutlet, setIsCreatingOutlet] = useState(false);
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isOutletDialogOpen, setIsOutletDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteType, setInviteType] = useState<"admin" | "staff">("staff");
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [canAccessClock, setCanAccessClock] = useState(true);
  const [canAccessBackoffice, setCanAccessBackoffice] = useState(false);
  const [issuedInvite, setIssuedInvite] = useState("");
  const [issuedResetLink, setIssuedResetLink] = useState("");
  const [message, setMessage] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [outletMessage, setOutletMessage] = useState("");
  const [resettingUserId, setResettingUserId] = useState("");
  const [revokingInvitationId, setRevokingInvitationId] = useState("");
  const [editingOutletId, setEditingOutletId] = useState("");
  const [assignmentKey, setAssignmentKey] = useState("");
  const [deviceActionId, setDeviceActionId] = useState("");
  const [permissionUserId, setPermissionUserId] = useState("");
  const [activeTeamView, setActiveTeamView] = useState<TeamView>(
    initialView ?? "people",
  );
  const [showAllStaffDevices, setShowAllStaffDevices] = useState(false);

  useEffect(() => {
    if (pathname === "/team") router.replace("/outlets");
  }, [pathname, router]);

  useEffect(() => {
    let active = true;
    loadTeamData(outletId)
      .then((team) => {
        if (!active) return;
        if (outletsOnly && !team.isAdmin) {
          router.replace("/manage");
          return;
        }
        setData(team);
        setOutletIds(
          outletId ? [outletId] : team.outlets[0] ? [team.outlets[0].id] : [],
        );
        setActiveTeamView(initialView ?? "people");
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
  }, [initialView, outletId, outletsOnly, router]);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isInviting || (inviteType === "staff" && !outletIds.length)) return;
    setIsInviting(true);
    setInviteMessage("");
    setIssuedInvite("");
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          accountType: inviteType,
          canAccessClock,
          canAccessBackoffice,
          outletIds,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not create invitation.");
      setIssuedInvite(body.inviteUrl);
      setInviteMessage(
        `Link created for ${email}. It expires ${formatExpiry(body.expiresAt)}.`,
      );
      setEmail("");
      setData(await loadTeamData(outletId));
    } catch (error) {
      setInviteMessage(
        error instanceof Error ? error.message : "Could not create invitation.",
      );
    } finally {
      setIsInviting(false);
    }
  }

  async function handleCreateOutlet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingOutlet) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setIsCreatingOutlet(true);
    setOutletMessage("");
    try {
      const response = await fetch("/api/outlets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          address: formData.get("address"),
          latitude: Number(formData.get("latitude")),
          longitude: Number(formData.get("longitude")),
          radiusMeters: Number(formData.get("radiusMeters")),
          timezone: formData.get("timezone"),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not create outlet.");
      const team = await loadTeamData(outletId);
      setData(team);
      setOutletIds([body.outlet.id]);
      setMessage(`${body.outlet.name} was added.`);
      setIsOutletDialogOpen(false);
      form.reset();
    } catch (error) {
      setOutletMessage(
        error instanceof Error ? error.message : "Could not create outlet.",
      );
    } finally {
      setIsCreatingOutlet(false);
    }
  }

  async function handleEditOutlet(
    event: FormEvent<HTMLFormElement>,
    id: string,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setOutletMessage("");
    try {
      const response = await fetch("/api/outlets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: formData.get("name"),
          address: formData.get("address"),
          latitude: Number(formData.get("latitude")),
          longitude: Number(formData.get("longitude")),
          radiusMeters: Number(formData.get("radiusMeters")),
          timezone: formData.get("timezone"),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update outlet.");
      setData(await loadTeamData(outletId));
      setEditingOutletId("");
      setIsOutletDialogOpen(false);
      setMessage(`${body.outlet.name} was updated.`);
    } catch (error) {
      setOutletMessage(
        error instanceof Error ? error.message : "Could not update outlet.",
      );
    }
  }

  async function handleDeactivateOutlet(id: string, reason: string) {
    const outletName = data?.outlets.find((outlet) => outlet.id === id)?.name;
    if (!reason.trim()) {
      setOutletMessage("Enter a reason before deactivating this outlet.");
      return;
    }
    if (
      !window.confirm(
        `Deactivate ${outletName ?? "this outlet"}? Its historical shifts will remain available.`,
      )
    ) {
      return;
    }
    setOutletMessage("");
    try {
      const response = await fetch("/api/outlets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reason }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not deactivate outlet.");
      setData(await loadTeamData(outletId));
      setEditingOutletId("");
      setIsOutletDialogOpen(false);
      setMessage("Outlet deactivated. Its historical shifts remain available.");
    } catch (error) {
      setOutletMessage(
        error instanceof Error ? error.message : "Could not deactivate outlet.",
      );
    }
  }

  async function handleManagerAssignment(
    managerId: string,
    assignedOutletId: string,
    assigned: boolean,
  ) {
    const key = `${managerId}:${assignedOutletId}`;
    setAssignmentKey(key);
    setMessage("");
    try {
      const response = await fetch("/api/outlet-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerId,
          outletId: assignedOutletId,
          assigned,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update assignment.");
      setData(await loadTeamData(outletId));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update assignment.",
      );
      setData(await loadTeamData(outletId));
    } finally {
      setAssignmentKey("");
    }
  }

  async function handleAccessChange(
    person: TeamPerson,
    permission: "canAccessClock" | "canAccessBackoffice",
    enabled: boolean,
  ) {
    if (permissionUserId) return;
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

  async function handleRevoke(invitationId: string) {
    if (revokingInvitationId) return;
    setRevokingInvitationId(invitationId);
    setMessage("");
    try {
      const response = await fetch(`/api/invitations/${invitationId}`, {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not revoke invitation.");
      setData(await loadTeamData(outletId));
      setMessage("Invitation revoked. Its link can no longer be used.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not revoke invitation.",
      );
    } finally {
      setRevokingInvitationId("");
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(issuedInvite);
      setInviteMessage("Invitation link copied.");
    } catch {
      setInviteMessage("Copy failed. Select and copy the invitation link.");
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
            {message || "Sign in with an admin or manager account."}
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
      peopleById.set(member.userId, {
        userId: member.userId,
        name: member.name,
        email: member.email,
        assignments: [member],
        canAccessClock: member.canAccessClock,
        canAccessBackoffice: member.canAccessBackoffice,
        canManageAccess: member.canManageAccess,
        canReset: member.canReset,
      });
    }
  }
  const visiblePeople = Array.from(peopleById.values());
  visiblePeople.sort((left, right) => {
    const leftRole = Math.min(
      ...left.assignments.map(({ role }) => roleOrder[role]),
    );
    const rightRole = Math.min(
      ...right.assignments.map(({ role }) => roleOrder[role]),
    );
    return leftRole - rightRole || left.name.localeCompare(right.name);
  });
  const staffMembers = Array.from(
    new Map(
      data.members
        .filter((member) => member.role === "staff")
        .map((member) => [member.userId, member]),
    ).values(),
  );
  const visibleStaffMembers = staffMembers
    .filter(
      (member) =>
        showAllStaffDevices ||
        data.staffDevices.some((device) => device.userId === member.userId),
    )
    .sort((left, right) => {
      const leftPending = data.staffDevices.some(
        (device) =>
          device.userId === left.userId && device.status === "pending",
      );
      const rightPending = data.staffDevices.some(
        (device) =>
          device.userId === right.userId && device.status === "pending",
      );
      return (
        Number(rightPending) - Number(leftPending) ||
        left.name.localeCompare(right.name)
      );
    });
  const pendingDeviceCount = data.staffDevices.filter(
    (device) => device.status === "pending",
  ).length;
  const visibleTeamViews: { id: TeamView; label: string; count?: number }[] =
    outletsOnly
      ? []
      : [
          { id: "people", label: "People" },
          {
            id: "invitations",
            label: "Invitations",
            count: data.invitations.length,
          },
          { id: "devices", label: "Devices", count: pendingDeviceCount },
        ];
  const editingOutlet = data.outlets.find(
    (outlet) => outlet.id === editingOutletId,
  );

  return (
    <div className="team-page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {data.isSuperAdmin ? "SUPER ADMIN" : "BACKOFFICE ACCESS"}
          </p>
          <h1>{outletsOnly ? "Outlets" : "Team"}</h1>
          <p className="subheading">
            {outletsOnly
              ? "Manage outlet details and clock-in locations."
              : outletId
                ? "Manage people, invitations, and clock-in access for this outlet."
                : "Manage people and access across your outlets."}
          </p>
        </div>
      </div>
      {message && (
        <p className="team-message" role="status" aria-live="polite">
          {message}
        </p>
      )}

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

      {activeTeamView === "locations" && data.isAdmin && (
        <section className="team-list-section" aria-labelledby="outlets-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">OUTLET MANAGEMENT</p>
              <h2 id="outlets-title">Outlets</h2>
              <p className="team-section-description">
                Manage outlet details and clock-in locations.
              </p>
            </div>
            <div className="team-heading-actions">
              <span className="team-count">{data.outlets.length}</span>
              <button
                className="team-secondary-action"
                type="button"
                onClick={() => {
                  setEditingOutletId("");
                  setOutletMessage("");
                  setIsOutletDialogOpen(true);
                }}
              >
                Add outlet
              </button>
            </div>
          </div>
          <div className="outlet-list" aria-label="Active outlets">
            {data.outlets.length ? (
              data.outlets.map((outlet) => (
                <div className="outlet-list-item" key={outlet.id}>
                  <div className="outlet-list-heading">
                    <div>
                      <strong>{outlet.name}</strong>
                      <small>{outlet.address}</small>
                    </div>
                    <button
                      className="reset-link-button"
                      type="button"
                      onClick={() => {
                        setEditingOutletId(outlet.id);
                        setOutletMessage("");
                        setIsOutletDialogOpen(true);
                      }}
                    >
                      Edit outlet
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="team-empty-outlets">
                No outlets yet. Add an outlet to set up your locations.
              </p>
            )}
          </div>
          <ModalDialog
            open={isOutletDialogOpen}
            onOpenChange={(isOpen) => {
              setIsOutletDialogOpen(isOpen);
              if (!isOpen) setEditingOutletId("");
            }}
            labelledBy="outlet-dialog-title"
          >
            <div className="dialog-panel">
              <header className="dialog-header">
                <div>
                  <p className="eyebrow">COMPANY LOCATIONS</p>
                  <h2 id="outlet-dialog-title">
                    {editingOutlet ? "Edit outlet" : "Add outlet"}
                  </h2>
                </div>
                <button
                  className="dialog-close"
                  type="button"
                  aria-label="Close dialog"
                  onClick={() => setIsOutletDialogOpen(false)}
                >
                  ×
                </button>
              </header>
              <form
                className="team-dialog-form"
                key={editingOutlet?.id ?? "new-outlet"}
                onSubmit={(event) =>
                  editingOutlet
                    ? void handleEditOutlet(event, editingOutlet.id)
                    : void handleCreateOutlet(event)
                }
              >
                <label>
                  Outlet name
                  <input
                    name="name"
                    defaultValue={editingOutlet?.name}
                    required
                    maxLength={120}
                  />
                </label>
                <label className="dialog-wide-field">
                  Address
                  <input
                    name="address"
                    defaultValue={editingOutlet?.address}
                    required
                    maxLength={300}
                  />
                </label>
                <label>
                  Latitude
                  <input
                    name="latitude"
                    type="number"
                    min={-90}
                    max={90}
                    step="any"
                    defaultValue={editingOutlet?.latitude}
                    required
                  />
                </label>
                <label>
                  Longitude
                  <input
                    name="longitude"
                    type="number"
                    min={-180}
                    max={180}
                    step="any"
                    defaultValue={editingOutlet?.longitude}
                    required
                  />
                </label>
                <label>
                  Geofence radius (meters)
                  <input
                    name="radiusMeters"
                    type="number"
                    min={25}
                    max={1000}
                    step={1}
                    defaultValue={editingOutlet?.radiusMeters ?? 100}
                    required
                  />
                </label>
                <label>
                  IANA timezone
                  <input
                    name="timezone"
                    defaultValue={
                      editingOutlet?.timezone ?? "Asia/Kuala_Lumpur"
                    }
                    required
                    maxLength={100}
                  />
                </label>
                {editingOutlet && (
                  <div className="dialog-danger-zone dialog-wide-field">
                    <label>
                      Deactivation reason
                      <input name="deactivationReason" maxLength={500} />
                    </label>
                    <button
                      className="deactivate-outlet-button"
                      type="button"
                      onClick={(event) =>
                        void handleDeactivateOutlet(
                          editingOutlet.id,
                          String(
                            new FormData(event.currentTarget.form!).get(
                              "deactivationReason",
                            ) ?? "",
                          ),
                        )
                      }
                    >
                      Deactivate outlet
                    </button>
                  </div>
                )}
                {outletMessage && (
                  <p className="team-message dialog-wide-field" role="alert">
                    {outletMessage}
                  </p>
                )}
                <div className="dialog-actions dialog-wide-field">
                  <button
                    className="team-secondary-action"
                    type="button"
                    onClick={() => setIsOutletDialogOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="team-primary-action"
                    type="submit"
                    disabled={isCreatingOutlet}
                  >
                    {isCreatingOutlet
                      ? "Saving…"
                      : editingOutlet
                        ? "Save changes"
                        : "Add outlet"}
                  </button>
                </div>
              </form>
            </div>
          </ModalDialog>
          {data.managers.length > 0 && (
            <div className="manager-assignment-list">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">MANAGER ACCESS</p>
                  <h2>Outlet assignments</h2>
                </div>
                <span className="team-count">{data.managers.length}</span>
              </div>
              {data.managers.map((manager) => (
                <div className="manager-assignment-row" key={manager.id}>
                  <div className="manager-assignment-person">
                    <strong>{manager.name}</strong>
                    <small>{manager.email}</small>
                  </div>
                  <details className="manager-assignment-details">
                    <summary>Manage outlet access</summary>
                    <div className="manager-outlet-options">
                      {data.outlets.map((outlet) => {
                        const key = `${manager.id}:${outlet.id}`;
                        const assigned = data.managerAssignments.some(
                          (assignment) =>
                            assignment.userId === manager.id &&
                            assignment.outletId === outlet.id &&
                            assignment.isActive,
                        );
                        return (
                          <label key={outlet.id}>
                            <input
                              type="checkbox"
                              checked={assigned}
                              disabled={assignmentKey === key}
                              onChange={(event) =>
                                void handleManagerAssignment(
                                  manager.id,
                                  outlet.id,
                                  event.target.checked,
                                )
                              }
                            />
                            {outlet.name}
                          </label>
                        );
                      })}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ModalDialog
        open={isInviteDialogOpen}
        onOpenChange={setIsInviteDialogOpen}
        labelledBy="invite-team-title"
      >
        <div className="dialog-panel">
          <header className="dialog-header">
            <div>
              <p className="eyebrow">NEW ACCESS</p>
              <h2 id="invite-team-title">Invite a person</h2>
            </div>
            <button
              className="dialog-close"
              type="button"
              aria-label="Close dialog"
              onClick={() => setIsInviteDialogOpen(false)}
            >
              ×
            </button>
          </header>
          {data.outlets.length || data.isSuperAdmin ? (
            <form
              className="team-dialog-form invite-dialog-form"
              onSubmit={handleInvite}
            >
              <label>
                Work email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              {data.isSuperAdmin && (
                <label>
                  Account type
                  <select
                    value={inviteType}
                    onChange={(event) => {
                      const nextType = event.target.value as typeof inviteType;
                      setInviteType(nextType);
                      setCanAccessClock(nextType === "staff");
                      setCanAccessBackoffice(true);
                    }}
                  >
                    <option value="admin">Admin</option>
                    <option value="staff">Staff</option>
                  </select>
                </label>
              )}
              <fieldset className="dialog-access-options">
                <legend>App access</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={canAccessClock}
                    onChange={(event) =>
                      setCanAccessClock(event.target.checked)
                    }
                  />
                  Clock
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={canAccessBackoffice}
                    onChange={(event) =>
                      setCanAccessBackoffice(event.target.checked)
                    }
                  />
                  Backoffice
                </label>
              </fieldset>
              {data.outlets.length > 0 && (
                <fieldset className="dialog-access-options dialog-outlet-options">
                  <legend>Outlet assignments</legend>
                  {data.outlets.map((outlet) => (
                    <label key={outlet.id}>
                      <input
                        type="checkbox"
                        checked={outletIds.includes(outlet.id)}
                        onChange={(event) =>
                          setOutletIds((current) =>
                            event.target.checked
                              ? [...current, outlet.id]
                              : current.filter((id) => id !== outlet.id),
                          )
                        }
                      />
                      {outlet.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <div className="dialog-actions">
                <button
                  className="team-secondary-action"
                  type="button"
                  onClick={() => setIsInviteDialogOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="team-primary-action"
                  type="submit"
                  disabled={isInviting}
                >
                  {isInviting ? "Creating…" : "Create invite link"}
                </button>
              </div>
            </form>
          ) : (
            <p className="auth-description">
              No active outlets are available for your account.
            </p>
          )}
          {inviteMessage && (
            <p className="team-message" role="status" aria-live="polite">
              {inviteMessage}
            </p>
          )}
          {issuedInvite && (
            <div className="issued-invite">
              <input
                aria-label="Invitation link"
                readOnly
                value={issuedInvite}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                className="copy-invite-button"
                type="button"
                onClick={copyInvite}
              >
                Copy link
              </button>
              <p>
                This link works once and expires after seven days. Share it only
                with the invited person.
              </p>
            </div>
          )}
        </div>
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
                Manage people and their outlet access.
              </p>
            </div>
            <div className="team-heading-actions">
              <span className="team-count">{visiblePeople.length}</span>
              <button
                className="team-primary-action"
                type="button"
                disabled={!data.outlets.length && !data.isSuperAdmin}
                onClick={() => {
                  setInviteMessage("");
                  setIsInviteDialogOpen(true);
                }}
              >
                Add person
              </button>
            </div>
          </div>
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>OUTLET ACCESS</th>
                  <th>APP ACCESS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visiblePeople.map((person) => (
                  <tr key={person.userId}>
                    <td>
                      <strong>{person.name}</strong>
                      <small>{person.email}</small>
                    </td>
                    <td className="team-assignment-cell">
                      <div className="team-access-list">
                        {person.assignments.map((assignment) => (
                          <div
                            className="team-access-item"
                            key={assignment.outletId}
                          >
                            <span>{assignment.outletName}</span>
                            <span className="team-role">{assignment.role}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td>
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
                    <td>
                      {person.canReset && (
                        <details className="team-person-actions">
                          <summary>Actions</summary>
                          <div>
                            <button
                              className="reset-link-button"
                              type="button"
                              disabled={Boolean(resettingUserId)}
                              onClick={() =>
                                void handleReset(person.userId, person.email)
                              }
                            >
                              {resettingUserId === person.userId
                                ? "Creating…"
                                : "Create reset link"}
                            </button>
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
                {!visiblePeople.length && (
                  <tr>
                    <td colSpan={4} className="empty-table">
                      No team members found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

      {activeTeamView === "devices" && (
        <section
          className="team-list-section"
          aria-labelledby="staff-devices-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">CLOCK-IN ACCESS</p>
              <h2 id="staff-devices-title">Staff devices</h2>
            </div>
            <div className="team-heading-actions">
              <label className="device-all-staff-toggle">
                <input
                  type="checkbox"
                  checked={showAllStaffDevices}
                  onChange={(event) =>
                    setShowAllStaffDevices(event.target.checked)
                  }
                />
                Show all staff
              </label>
              <span className="team-count">{visibleStaffMembers.length}</span>
            </div>
          </div>
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>DEVICE STATUS</th>
                  <th>REQUESTED</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {visibleStaffMembers.map((member) => {
                  const devices = data.staffDevices.filter(
                    (device) => device.userId === member.userId,
                  );
                  const pending = devices.find(
                    (device) => device.status === "pending",
                  );
                  const active = devices.find(
                    (device) => device.status === "active",
                  );
                  return (
                    <tr key={member.userId}>
                      <td>
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </td>
                      <td>
                        {pending
                          ? active
                            ? "Replacement awaiting approval"
                            : "Awaiting approval"
                          : active
                            ? "Approved"
                            : "Not enrolled"}
                      </td>
                      <td>
                        {pending
                          ? formatExpiry(pending.createdAt)
                          : active?.approvedAt
                            ? formatExpiry(active.approvedAt)
                            : "—"}
                      </td>
                      <td>
                        {pending && (
                          <Link
                            className="reset-link-button"
                            href="/device-requests"
                          >
                            Review request
                          </Link>
                        )}
                        {active && (
                          <button
                            className="reset-link-button"
                            type="button"
                            disabled={Boolean(deviceActionId)}
                            onClick={() =>
                              void handleStaffDeviceAction(active.id, "revoke")
                            }
                          >
                            {deviceActionId === active.id
                              ? "Saving…"
                              : "Revoke"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!visibleStaffMembers.length && (
                  <tr>
                    <td colSpan={4} className="empty-table">
                      {showAllStaffDevices
                        ? "No staff members found."
                        : "No device requests or enrolled devices."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data.staffDevices.some((device) => device.status === "pending") && (
            <p className="auth-description">
              Approving a replacement immediately revokes the previous device.
            </p>
          )}
        </section>
      )}

      {activeTeamView === "invitations" && (
        <section
          className="team-list-section"
          aria-labelledby="pending-invites-title"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">UNACCEPTED LINKS</p>
              <h2 id="pending-invites-title">Pending invitations</h2>
            </div>
            <span className="team-count">{data.invitations.length}</span>
          </div>
          <div className="pending-invite-list">
            {data.invitations.map((invitation) => (
              <div className="pending-invite-row" key={invitation.id}>
                <strong>{invitation.email}</strong>
                <span>
                  {invitation.accountType} ·{" "}
                  {[
                    invitation.canAccessClock && "Clock",
                    invitation.canAccessBackoffice && "Backoffice",
                  ]
                    .filter(Boolean)
                    .join(" + ")}{" "}
                  · {invitation.outletNames.join(", ") || "No outlets yet"}
                </span>
                <small>Expires {formatExpiry(invitation.expiresAt)}</small>
                <button
                  className="reset-link-button"
                  type="button"
                  disabled={Boolean(revokingInvitationId)}
                  onClick={() => void handleRevoke(invitation.id)}
                >
                  {revokingInvitationId === invitation.id
                    ? "Revoking…"
                    : "Revoke link"}
                </button>
              </div>
            ))}
            {!data.invitations.length && (
              <p className="auth-description">No pending invitations.</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
