"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ModalDialog } from "./modal-dialog";

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

/**
 * Promise-based confirmation. Usage:
 *
 *   const { confirm, confirmDialog } = useConfirmDialog();
 *   if (!(await confirm({ title: "Revoke device?" }))) return;
 *   ...
 *   return <>{confirmDialog}</>;
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolverRef.current?.(confirmed);
    resolverRef.current = null;
    setPending(null);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolverRef.current?.(false);
        resolverRef.current = resolve;
        setPending(options);
      }),
    [],
  );

  const confirmDialog = <ConfirmDialog options={pending} onSettle={settle} />;

  return { confirm, confirmDialog };
}

function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions | null;
  onSettle: (confirmed: boolean) => void;
}) {
  const { messages } = useLocale();
  return (
    <ModalDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) onSettle(false);
      }}
      labelledBy="confirm-dialog-title"
    >
      {options && (
        <div className="dialog-panel confirm-dialog-panel">
          <header className="dialog-header confirm-dialog-header">
            <div>
              <h2 id="confirm-dialog-title">{options.title}</h2>
              {options.description && (
                <p className="confirm-dialog-description">
                  {options.description}
                </p>
              )}
            </div>
          </header>
          <div className="confirm-dialog-actions">
            <button
              className="btn btn-secondary btn-lg"
              type="button"
              onClick={() => onSettle(false)}
            >
              {options.cancelLabel ?? messages.shell.dialog.cancel}
            </button>
            <button
              className={`btn btn-lg ${options.tone === "danger" ? "btn-danger-solid" : "btn-primary"}`}
              type="button"
              onClick={() => onSettle(true)}
            >
              {options.confirmLabel ?? messages.shell.dialog.confirm}
            </button>
          </div>
        </div>
      )}
    </ModalDialog>
  );
}
