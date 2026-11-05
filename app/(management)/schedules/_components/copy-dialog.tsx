"use client";

import {
  formatRangeLabel,
} from "@/app/(management)/schedules/_components/schedule-format";
import { CloseIcon } from "@/app/_components/icons";
import { ModalDialog } from "@/app/_components/modal-dialog";
import { startOfWeek } from "@/lib/schedule-rules";
import { addDaysToDateKey } from "@/lib/timesheet-off-days";
import { useState, type FormEvent } from "react";

export type CopyValues = {
  sourceFrom: string;
  sourceTo: string;
  targetFrom: string;
  repeat: number;
};

export function CopyDialog({
  anchorWeek,
  outletName,
  isSaving,
  onOpenChange,
  onCopy,
}: {
  /** Monday of the week currently in focus. */
  anchorWeek: string;
  outletName: string;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onCopy: (values: CopyValues) => Promise<void>;
}) {
  const [sourceWeek, setSourceWeek] = useState(addDaysToDateKey(anchorWeek, -7));
  const [targetWeek, setTargetWeek] = useState(anchorWeek);
  const [repeat, setRepeat] = useState(1);
  const source = startOfWeek(sourceWeek || anchorWeek);
  const target = startOfWeek(targetWeek || anchorWeek);
  const lastTarget = addDaysToDateKey(target, repeat * 7 - 1);
  const overlaps = target <= addDaysToDateKey(source, 6) && lastTarget >= source;

  function preset(nextSource: string, nextTarget: string, nextRepeat: number) {
    setSourceWeek(nextSource);
    setTargetWeek(nextTarget);
    setRepeat(nextRepeat);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (overlaps) return;
    await onCopy({
      sourceFrom: source,
      sourceTo: addDaysToDateKey(source, 6),
      targetFrom: target,
      repeat,
    });
  }

  return (
    <ModalDialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
      labelledBy="schedule-copy-title"
    >
      <div className="dialog-panel schedule-dialog-panel">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">{outletName}</p>
            <h2 id="schedule-copy-title">Copy or repeat a week</h2>
            <p className="subheading">
              Copies arrive as drafts. Shifts that would clash with existing
              ones are skipped.
            </p>
          </div>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => onOpenChange(false)}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="schedule-copy-presets">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => preset(addDaysToDateKey(anchorWeek, -7), anchorWeek, 1)}
          >
            Last week → this week
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => preset(anchorWeek, addDaysToDateKey(anchorWeek, 7), 1)}
          >
            This week → next week
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => preset(anchorWeek, addDaysToDateKey(anchorWeek, 7), 4)}
          >
            Repeat this week × 4
          </button>
        </div>
        <form className="schedule-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Copy the week of
            <input
              type="date"
              required
              value={sourceWeek}
              onChange={(event) => setSourceWeek(event.target.value)}
            />
            <small>{formatRangeLabel(source, addDaysToDateKey(source, 6), "week")}</small>
          </label>
          <label>
            Into the week of
            <input
              type="date"
              required
              value={targetWeek}
              onChange={(event) => setTargetWeek(event.target.value)}
            />
            <small>{formatRangeLabel(target, addDaysToDateKey(target, 6), "week")}</small>
          </label>
          <label>
            Number of weeks
            <input
              type="number"
              min={1}
              max={12}
              value={repeat}
              onChange={(event) =>
                setRepeat(Math.min(12, Math.max(1, Number(event.target.value) || 1)))
              }
            />
          </label>
          <div className="schedule-form-summary">
            <span>Fills</span>
            <strong>{formatRangeLabel(target, lastTarget, "week")}</strong>
          </div>
          {overlaps && (
            <p className="schedule-form-wide schedule-form-error" role="alert">
              The target weeks cannot include the week being copied.
            </p>
          )}
          <div className="dialog-actions schedule-form-actions">
            <span className="schedule-form-spacer" />
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
              disabled={isSaving || overlaps}
            >
              {isSaving ? "Copying…" : "Copy shifts"}
            </button>
          </div>
        </form>
      </div>
    </ModalDialog>
  );
}
