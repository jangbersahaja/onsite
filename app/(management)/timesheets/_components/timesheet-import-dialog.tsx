"use client";

import { useConfirmDialog } from "@/app/_components/confirm-dialog";
import { CloseIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { useState, type ChangeEvent, type FormEvent } from "react";

type ImportOutlet = { id: string; name: string };

type ImportPreviewRow = {
  rowNumber: number;
  staffCode: string | null;
  username: string | null;
  status: "ok" | "error";
  message: string | null;
  breakCount: number;
};

type ImportPreview = {
  rows: ImportPreviewRow[];
  importableCount: number;
  errorCount: number;
};

type ImportResponse = {
  error?: string;
  rows?: ImportPreviewRow[];
  importableCount?: number;
  errorCount?: number;
  importedCount?: number;
  skippedCount?: number;
};

const MAX_IMPORT_FILE_BYTES = 1_000_000;

type TimesheetImportDialogProps = {
  outlets: ImportOutlet[];
  outletId: string;
  importExportHref: string;
  onOpenChange: (open: boolean) => void;
  onImported: (message: string) => void;
};

async function readImportResponse(response: Response) {
  return (await response.json().catch(() => ({}))) as ImportResponse;
}

export function TimesheetImportDialog({
  outlets,
  outletId,
  importExportHref,
  onOpenChange,
  onImported,
}: TimesheetImportDialogProps) {
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [error, setError] = useState("");
  const { confirm, confirmDialog } = useConfirmDialog();

  async function runPreview(nextOutletId: string, nextCsvText: string) {
    setBusy("preview");
    setError("");
    try {
      const response = await fetch("/api/timesheets/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId: nextOutletId,
          csvText: nextCsvText,
        }),
      });
      const body = await readImportResponse(response);
      if (!response.ok)
        throw new Error(body.error ?? "Could not check this file.");
      setPreview({
        rows: body.rows ?? [],
        importableCount: body.importableCount ?? 0,
        errorCount: body.errorCount ?? 0,
      });
    } catch (caught) {
      setPreview(null);
      setError(
        caught instanceof Error ? caught.message : "Could not check this file.",
      );
    } finally {
      setBusy("");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreview(null);
    setError("");
    if (!file) {
      setFileName("");
      setCsvText("");
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setFileName("");
      setCsvText("");
      setError("This file is too large. The limit is 1 MB.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    await runPreview(outletId, text);
  }

  async function handleCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || !preview.importableCount || busy) return;
    const outletName =
      outlets.find((outlet) => outlet.id === outletId)?.name ?? "this outlet";
    const count = preview.importableCount;
    if (
      !(await confirm({
        title: `Import ${count} shift${count === 1 ? "" : "s"}?`,
        description: `Valid rows will be added to ${outletName} and recorded in the audit log. Rows with errors will be skipped.`,
        confirmLabel: "Import shifts",
      }))
    )
      return;

    setBusy("commit");
    setError("");
    try {
      const response = await fetch("/api/timesheets/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outletId,
          csvText,
          reason: reason.trim(),
        }),
      });
      const body = await readImportResponse(response);
      if (!response.ok)
        throw new Error(body.error ?? "Could not import shifts.");
      if (!body.importedCount) {
        setPreview({
          rows: body.rows ?? [],
          importableCount: 0,
          errorCount: body.skippedCount ?? 0,
        });
        setError("No rows were imported. Fix the errors and try again.");
        return;
      }
      onImported(
        `Imported ${body.importedCount} shift${body.importedCount === 1 ? "" : "s"}. Skipped ${body.skippedCount ?? 0} row${body.skippedCount === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not import shifts.",
      );
    } finally {
      setBusy("");
    }
  }

  const importableCount = preview?.importableCount ?? 0;
  const canCommit =
    Boolean(preview && importableCount) &&
    reason.trim().length >= 3 &&
    busy === "";

  return (
    <>
      <ModalDialog
        open
        onOpenChange={(open) => {
          if (!open) onOpenChange(false);
        }}
        labelledBy="timesheet-import-title"
      >
        <div className="dialog-panel timesheet-edit-dialog-panel">
          <header className="dialog-header">
            <div>
              <p className="eyebrow">PAYROLL REVIEW</p>
              <h2 id="timesheet-import-title">Import shifts from CSV</h2>
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              type="button"
              aria-label="Close import"
              title="Close import"
              onClick={() => onOpenChange(false)}
            >
              <CloseIcon />
            </button>
          </header>

          <div className="timesheet-edit-fields">
            <label>
              CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy !== ""}
                onChange={(event) => void handleFileChange(event)}
              />
            </label>
            <p className="dialog-description timesheet-import-note">
              Need the format?{" "}
              <a href="/api/timesheets/import/template" download>
                Download the template
              </a>
              . Staff are matched by staff code. Rows with errors, duplicates,
              or clashes with existing shifts are skipped. Valid rows are
              imported.
            </p>
            <a
              className="btn btn-secondary timesheet-import-export"
              href={importExportHref}
              download
            >
              <span aria-hidden="true">↓</span> Export this outlet&apos;s import
              file
            </a>
          </div>

          {busy === "preview" && (
            <p className="dialog-description" aria-live="polite">
              Checking file…
            </p>
          )}
          {error && (
            <p className="team-message" role="alert">
              {error}
            </p>
          )}

          {preview && (
            <>
              <p className="dialog-description" aria-live="polite">
                {fileName && `${fileName}: `}
                {preview.importableCount} ready to import, {preview.errorCount}{" "}
                with errors.
              </p>
              <div className="team-table-wrap">
                <table className="team-table">
                  <thead>
                    <tr>
                      <th>ROW</th>
                      <th>STAFF CODE</th>
                      <th>NAME</th>
                      <th>BREAKS</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td data-label="Row">{row.rowNumber}</td>
                        <td data-label="Staff code">{row.staffCode ?? "—"}</td>
                        <td data-label="Name">{row.username ?? "—"}</td>
                        <td data-label="Breaks">{row.breakCount}</td>
                        <td data-label="Status">
                          {row.status === "ok"
                            ? "Ready"
                            : (row.message ?? "Skipped")}
                        </td>
                      </tr>
                    ))}
                    {!preview.rows.length && (
                      <tr>
                        <td colSpan={5} className="empty-table">
                          The file has no shift rows.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <form
                className="timesheet-edit-fields"
                onSubmit={(event) => void handleCommit(event)}
              >
                <label className="timesheet-reason">
                  Reason for importing these shifts
                  <input
                    required
                    minLength={3}
                    maxLength={500}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="dialog-actions">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={!canCommit}
                  >
                    {busy === "commit"
                      ? "Importing…"
                      : `Import ${importableCount} shift${importableCount === 1 ? "" : "s"}`}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </ModalDialog>
      {confirmDialog}
    </>
  );
}
