// Curated staff-fault reasons for correction requests. Stored as stable codes
// so the data can be counted and analysed; labels are localized in lib/i18n.
export const CORRECTION_REASON_CODES = [
  "forgot_clock_in",
  "forgot_clock_out",
  "forgot_break",
  "gps_problem",
  "device_problem",
  "other",
] as const;

export type CorrectionReasonCode = (typeof CORRECTION_REASON_CODES)[number];

export function isCorrectionReasonCode(
  value: unknown,
): value is CorrectionReasonCode {
  return (
    typeof value === "string" &&
    (CORRECTION_REASON_CODES as readonly string[]).includes(value)
  );
}
