import type { Messages } from "@/lib/i18n/messages";

/**
 * An error to show to the user. Keep the code and the English fallback text
 * separate so the message re-translates when the language changes.
 */
export type ErrorText = { code?: string | null; text: string };

export function errorMessage(messages: Messages, error: ErrorText): string {
  if (error.code && error.code in messages.errors) {
    return messages.errors[error.code as keyof Messages["errors"]];
  }
  return error.text;
}
