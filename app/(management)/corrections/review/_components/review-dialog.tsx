"use client";

import { CloseIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import type { ComponentProps, FormEvent, ReactNode } from "react";

export type ReviewNoticeState = {
  tone: "success" | "error";
  text: string;
};

export function ReviewNotice({ notice }: { notice: ReviewNoticeState }) {
  return (
    <p
      className="team-message"
      role={notice.tone === "error" ? "alert" : "status"}
    >
      {notice.text}
    </p>
  );
}

type ReviewDialogProps = {
  titleId: string;
  header: { eyebrow: string; title: string; subtitle?: string } | null;
  onClose: () => void;
  summary?: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
};

/** Shared shell for the three review dialogs. Renders nothing until an item is selected. */
export function ReviewDialog({
  titleId,
  header,
  onClose,
  summary,
  notice,
  children,
}: ReviewDialogProps) {
  return (
    <ModalDialog
      open={header !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      labelledBy={titleId}
    >
      {header && (
        <div className="dialog-panel">
          <header className="dialog-header">
            <div>
              <p className="eyebrow">{header.eyebrow}</p>
              <h2 id={titleId}>{header.title}</h2>
              {header.subtitle && (
                <p className="correction-review-email">{header.subtitle}</p>
              )}
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              type="button"
              aria-label="Close dialog"
              title="Close dialog"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </header>
          {summary}
          {notice}
          {children}
        </div>
      )}
    </ModalDialog>
  );
}

/** Enter in a text field would otherwise submit with the first decision button. */
export function DecisionForm({
  onSubmit,
  children,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  return (
    <form
      className="correction-decision-form"
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
    >
      {children}
    </form>
  );
}

const BUTTON_CLASS = {
  approve: "btn btn-primary",
  secondary: "btn btn-secondary",
  note: "btn btn-ghost",
  reject: "btn btn-danger",
} as const;

type DecisionButtonProps = Omit<ComponentProps<"button">, "type"> & {
  variant: keyof typeof BUTTON_CLASS;
  /** Also used as the submitted decision value for form buttons. */
  action: string;
  /** The action currently in flight, or an empty string. */
  busy: string;
  type?: "submit" | "button";
};

/**
 * Only the button for the running action shows "Saving…".
 * All decision buttons are disabled while any action is in flight.
 */
export function DecisionButton({
  variant,
  action,
  busy,
  type = "submit",
  disabled,
  children,
  ...rest
}: DecisionButtonProps) {
  const pending = busy === action;
  return (
    <button
      {...rest}
      type={type}
      name={type === "submit" ? "decision" : undefined}
      value={action}
      className={BUTTON_CLASS[variant]}
      disabled={disabled || busy !== ""}
    >
      {pending ? "Saving…" : children}
    </button>
  );
}
