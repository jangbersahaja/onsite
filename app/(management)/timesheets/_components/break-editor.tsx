"use client";

import { TrashIcon } from "@/app/_components/icons";

export type EditingBreak = {
  id: string | null;
  startedAt: string;
  endedAt: string;
};

type BreakEditorProps = {
  timezone: string;
  breaks: EditingBreak[];
  onChange: (breaks: EditingBreak[]) => void;
  requireEnd?: boolean;
};

export function BreakEditor({
  timezone,
  breaks,
  onChange,
  requireEnd = false,
}: BreakEditorProps) {
  return (
    <div className="timesheet-break-editor">
      <div className="timesheet-break-heading">
        <strong>Breaks</strong>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() =>
            onChange([...breaks, { id: null, startedAt: "", endedAt: "" }])
          }
        >
          Add break
        </button>
      </div>
      {breaks.map((breakInterval, index) => (
        <div
          className="timesheet-break-fields"
          key={breakInterval.id ?? `new-${index}`}
        >
          <label>
            Break starts ({timezone})
            <input
              type="datetime-local"
              required
              value={breakInterval.startedAt}
              onChange={(event) =>
                onChange(
                  breaks.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, startedAt: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <label>
            Break ends
            <input
              type="datetime-local"
              required={requireEnd}
              value={breakInterval.endedAt}
              onChange={(event) =>
                onChange(
                  breaks.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, endedAt: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            type="button"
            aria-label="Remove break"
            title="Remove break"
            onClick={() =>
              onChange(breaks.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
