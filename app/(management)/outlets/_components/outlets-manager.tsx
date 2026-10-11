"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { PasswordInput } from "@/app/_components/password-input";
import { useEffect, useState, type FormEvent } from "react";

type OutletSummary = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  timezone: string;
  /** Only present for super admins. Never contains the API token. */
  storeHub?: { storeName: string; posStoreId: string } | null;
};

type OutletsData = {
  isSuperAdmin: boolean;
  outlets: OutletSummary[];
  backofficeUsers: { id: string; name: string; email: string }[];
  backofficeAssignments: {
    userId: string;
    outletId: string;
    isActive: boolean;
  }[];
};

async function loadOutletsData() {
  const response = await fetch("/api/team", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load outlets.");
  return body as OutletsData;
}

type StoreHubPayload = {
  storeName: string;
  posStoreId: string;
  token?: string;
};

/**
 * undefined leaves the link untouched, null unlinks, and an object links or updates it.
 * A blank token on an existing link keeps the stored token.
 */
function buildStoreHubPayload(
  formData: FormData,
  options: { enabled: boolean; wasLinked: boolean },
): StoreHubPayload | null | undefined {
  if (!options.enabled) return options.wasLinked ? null : undefined;
  const token = String(formData.get("storeHubToken") ?? "").trim();
  return {
    storeName: String(formData.get("storeHubStoreName") ?? "").trim(),
    posStoreId: String(formData.get("storeHubPosStoreId") ?? "").trim(),
    ...(token ? { token } : {}),
  };
}

export function OutletsManager() {
  const [data, setData] = useState<OutletsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingOutlet, setIsCreatingOutlet] = useState(false);
  const [isOutletDialogOpen, setIsOutletDialogOpen] = useState(false);
  const [editingOutletId, setEditingOutletId] = useState("");
  const [outletMessage, setOutletMessage] = useState("");
  const [storeHubEnabled, setStoreHubEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [assignmentKey, setAssignmentKey] = useState("");
  const [accessUserId, setAccessUserId] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  useEffect(() => {
    let active = true;
    loadOutletsData()
      .then((team) => {
        if (!active) return;
        setData(team);
      })
      .catch((error: unknown) => {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Could not load outlets.",
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function refresh() {
    setData(await loadOutletsData());
  }

  async function handleCreateOutlet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreatingOutlet) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    if (
      !(await confirm({
        title: `Create ${String(formData.get("name") ?? "").trim() || "this outlet"}?`,
        description:
          "The outlet will be available for clocking and team assignments.",
        confirmLabel: "Create outlet",
      }))
    )
      return;
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
          ...(data?.isSuperAdmin
            ? {
                storeHub: buildStoreHubPayload(formData, {
                  enabled: storeHubEnabled,
                  wasLinked: false,
                }),
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not create outlet.");
      await refresh();
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
    if (
      !(await confirm({
        title: `Save changes to ${String(formData.get("name") ?? "this outlet")}?`,
        description:
          "Clock-in location and radius will update for staff immediately.",
        confirmLabel: "Save changes",
      }))
    )
      return;
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
          ...(data?.isSuperAdmin
            ? {
                storeHub: buildStoreHubPayload(formData, {
                  enabled: storeHubEnabled,
                  wasLinked: Boolean(
                    data.outlets.find((outlet) => outlet.id === id)?.storeHub,
                  ),
                }),
              }
            : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update outlet.");
      await refresh();
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
      !(await confirm({
        title: `Deactivate ${outletName ?? "this outlet"}?`,
        description:
          "Its historical shifts will remain available, but staff can no longer clock in here.",
        confirmLabel: "Deactivate outlet",
        tone: "danger",
      }))
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
      await refresh();
      setEditingOutletId("");
      setIsOutletDialogOpen(false);
      setMessage("Outlet deactivated. Its historical shifts remain available.");
    } catch (error) {
      setOutletMessage(
        error instanceof Error ? error.message : "Could not deactivate outlet.",
      );
    }
  }

  async function handleBackofficeAssignment(
    userId: string,
    assignedOutletId: string,
    assigned: boolean,
  ) {
    const personName =
      data?.backofficeUsers.find((user) => user.id === userId)?.name ??
      "this user";
    const outletName =
      data?.outlets.find((outlet) => outlet.id === assignedOutletId)?.name ??
      "this outlet";
    if (
      !(await confirm({
        title: assigned
          ? `Assign ${personName} to ${outletName}?`
          : `Remove ${personName} from ${outletName}?`,
        description: assigned
          ? "They will be able to manage this outlet in backoffice."
          : "They will lose backoffice access to this outlet.",
        confirmLabel: assigned ? "Assign" : "Remove",
        tone: assigned ? "default" : "danger",
      }))
    )
      return;
    const key = `${userId}:${assignedOutletId}`;
    setAssignmentKey(key);
    setMessage("");
    try {
      const response = await fetch("/api/outlet-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          outletId: assignedOutletId,
          assigned,
        }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Could not update assignment.");
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update assignment.",
      );
      await refresh();
    } finally {
      setAssignmentKey("");
    }
  }

  if (isLoading) {
    return (
      <main className="loading-screen" aria-live="polite">
        Loading outlets…
      </main>
    );
  }

  if (!data) {
    return (
      <div className="team-page-content">
        <p className="team-message" role="alert">
          {message || "Outlets are unavailable."}
        </p>
      </div>
    );
  }

  const editingOutlet = data.outlets.find(
    (outlet) => outlet.id === editingOutletId,
  );
  const accessUser = data.backofficeUsers.find(
    (person) => person.id === accessUserId,
  );
  const isAssigned = (userId: string, outletId: string) =>
    data.backofficeAssignments.some(
      (assignment) =>
        assignment.userId === userId &&
        assignment.outletId === outletId &&
        assignment.isActive,
    );

  return (
    <div className="team-page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">COMPANY LOCATIONS</p>
          <h1>Outlets</h1>
          <p className="subheading">
            Manage outlet details, clock-in locations, and backoffice access.
          </p>
        </div>
      </div>
      {message && !accessUser && (
        <p className="team-message" role="status" aria-live="polite">
          {message}
        </p>
      )}

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
            {data.isSuperAdmin && (
              <button
                className="team-secondary-action"
                type="button"
                onClick={() => {
                  setEditingOutletId("");
                  setOutletMessage("");
                  setStoreHubEnabled(false);
                  setIsOutletDialogOpen(true);
                }}
              >
                Add outlet
              </button>
            )}
          </div>
        </div>
        <div className="outlet-list" aria-label="Active outlets">
          {data.outlets.length ? (
            data.outlets.map((outlet) => (
              <article className="outlet-card" key={outlet.id}>
                <header className="outlet-card-header">
                  <span className="outlet-avatar" aria-hidden="true">
                    {outlet.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="outlet-card-title">
                    <h3>{outlet.name}</h3>
                    <p>{outlet.address}</p>
                  </div>
                  <span className="outlet-card-status">Active</span>
                </header>
                <dl className="outlet-card-meta">
                  <div>
                    <dt>Geofence</dt>
                    <dd>{outlet.radiusMeters} m radius</dd>
                  </div>
                  <div>
                    <dt>Timezone</dt>
                    <dd>{outlet.timezone}</dd>
                  </div>
                  {outlet.storeHub !== undefined && (
                    <div className="outlet-card-meta-wide">
                      <dt>StoreHub</dt>
                      <dd>
                        {outlet.storeHub
                          ? `${outlet.storeHub.storeName} (store ${outlet.storeHub.posStoreId})`
                          : "Not linked"}
                      </dd>
                    </div>
                  )}
                  <div className="outlet-card-meta-wide">
                    <dt>Coordinates</dt>
                    <dd>
                      {outlet.latitude.toFixed(5)},{" "}
                      {outlet.longitude.toFixed(5)}
                    </dd>
                  </div>
                </dl>
                <footer className="outlet-card-footer">
                  <button
                    className="outlet-card-edit"
                    type="button"
                    aria-label={`Edit ${outlet.name}`}
                    onClick={() => {
                      setEditingOutletId(outlet.id);
                      setOutletMessage("");
                      setStoreHubEnabled(Boolean(outlet.storeHub));
                      setIsOutletDialogOpen(true);
                    }}
                  >
                    Edit outlet
                  </button>
                </footer>
              </article>
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
                  defaultValue={editingOutlet?.timezone ?? "Asia/Kuala_Lumpur"}
                  required
                  maxLength={100}
                />
              </label>
              {data.isSuperAdmin && (
                <fieldset className="dialog-wide-field dialog-storehub-fieldset">
                  <legend>StoreHub</legend>
                  <label className="dialog-checkbox-row">
                    <input
                      type="checkbox"
                      checked={storeHubEnabled}
                      onChange={(event) =>
                        setStoreHubEnabled(event.currentTarget.checked)
                      }
                    />
                    Link this outlet to StoreHub
                  </label>
                  {storeHubEnabled && (
                    <div className="dialog-storehub-fields">
                      <label>
                        StoreHub account name
                        <input
                          name="storeHubStoreName"
                          defaultValue={editingOutlet?.storeHub?.storeName}
                          required
                          maxLength={120}
                        />
                      </label>
                      <label>
                        POS store ID
                        <input
                          name="storeHubPosStoreId"
                          defaultValue={editingOutlet?.storeHub?.posStoreId}
                          required
                          maxLength={120}
                        />
                      </label>
                      <label className="dialog-wide-field">
                        API token
                        <PasswordInput
                          name="storeHubToken"
                          autoComplete="off"
                          required={!editingOutlet?.storeHub}
                          maxLength={500}
                          placeholder={
                            editingOutlet?.storeHub
                              ? "Leave blank to keep current token"
                              : undefined
                          }
                        />
                      </label>
                    </div>
                  )}
                </fieldset>
              )}
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
        {data.backofficeUsers.length > 0 && (
          <div className="manager-assignment-list">
            <div className="section-heading">
              <div>
                <p className="eyebrow">BACKOFFICE ACCESS</p>
                <h2>Outlet assignments</h2>
              </div>
              <span className="team-count">{data.backofficeUsers.length}</span>
            </div>
            {data.backofficeUsers.map((person) => {
              const assignedCount = data.outlets.filter((outlet) =>
                isAssigned(person.id, outlet.id),
              ).length;
              return (
                <div className="manager-assignment-row" key={person.id}>
                  <div className="manager-assignment-person">
                    <strong>{person.name}</strong>
                    <small>{person.email}</small>
                  </div>
                  <div className="manager-assignment-action">
                    <span className="manager-assignment-count">
                      {assignedCount} of {data.outlets.length} outlets
                    </span>
                    <button
                      className="team-secondary-action"
                      type="button"
                      onClick={() => {
                        setAccessUserId(person.id);
                        setMessage("");
                      }}
                    >
                      Manage outlet access
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <ModalDialog
          open={Boolean(accessUser)}
          onOpenChange={(isOpen) => {
            if (!isOpen) setAccessUserId("");
          }}
          labelledBy="backoffice-access-dialog-title"
        >
          {accessUser && (
            <div className="dialog-panel">
              <header className="dialog-header">
                <div>
                  <p className="eyebrow">BACKOFFICE ACCESS</p>
                  <h2 id="backoffice-access-dialog-title">Outlet access</h2>
                  <p className="dialog-description">
                    Choose the outlets {accessUser.name} can manage.
                  </p>
                </div>
                <button
                  className="dialog-close"
                  type="button"
                  aria-label="Close dialog"
                  onClick={() => setAccessUserId("")}
                >
                  ×
                </button>
              </header>
              {message && (
                <p className="team-message" role="alert">
                  {message}
                </p>
              )}
              <div className="outlet-access-options">
                {data.outlets.map((outlet) => {
                  const key = `${accessUser.id}:${outlet.id}`;
                  const assigned = isAssigned(accessUser.id, outlet.id);
                  return (
                    <label className="outlet-access-option" key={outlet.id}>
                      <input
                        type="checkbox"
                        checked={assigned}
                        disabled={assignmentKey === key}
                        onChange={(event) =>
                          void handleBackofficeAssignment(
                            accessUser.id,
                            outlet.id,
                            event.target.checked,
                          )
                        }
                      />
                      <span>
                        <strong>{outlet.name}</strong>
                        <small>{outlet.address}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="dialog-actions">
                <button
                  className="team-primary-action"
                  type="button"
                  onClick={() => setAccessUserId("")}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </ModalDialog>
      </section>
      {confirmDialog}
    </div>
  );
}
