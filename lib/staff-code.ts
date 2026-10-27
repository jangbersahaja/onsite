export const STAFF_CODE_MAX_LENGTH = 32;

const staffCodePattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Trims a staff code. Empty input means "no staff code" and returns null.
 * Returns an error message when the value is not a valid code.
 */
export function normalizeStaffCode(
  value: string | null | undefined,
): { value: string | null } | { error: string } {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { value: null };
  if (trimmed.length > STAFF_CODE_MAX_LENGTH) {
    return {
      error: `Staff code must be ${STAFF_CODE_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (!staffCodePattern.test(trimmed)) {
    return {
      error:
        "Staff code can only use letters, numbers, hyphens, and underscores, and must start with a letter or number.",
    };
  }
  return { value: trimmed };
}

/** Staff codes are matched case-insensitively. */
export function staffCodeKey(value: string) {
  return value.trim().toLowerCase();
}
