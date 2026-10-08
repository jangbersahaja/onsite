"use client";

import { useEffect, useRef, type ReactNode } from "react";

type ModalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labelledBy: string;
  children: ReactNode;
};

export function ModalDialog({
  open,
  onOpenChange,
  labelledBy,
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
      className="workspace-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onOpenChange(false);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
      ref={dialogRef}
    >
      {children}
    </dialog>
  );
}
