"use client";

import { ModalDialog } from "@/app/_components/modal-dialog";
import { authClient } from "@/lib/auth-client";
import {
  localeCookie,
  localeNames,
  locales,
  localeTags,
  type Locale,
} from "@/lib/i18n/config";
import { getMessages, type Messages } from "@/lib/i18n/messages";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type LocaleContextValue = {
  locale: Locale;
  messages: Messages;
  setLocale: (next: Locale) => Promise<boolean>;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const { data: session } = authClient.useSession();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Saved account locale wins whenever it changes (sign-in, or after a
  // switch on another device). Tracked during render so it doesn't need an
  // effect to sync state.
  const savedLocale = session?.user.locale ?? null;
  const [syncedLocale, setSyncedLocale] = useState<Locale | null>(null);
  if (savedLocale !== syncedLocale) {
    setSyncedLocale(savedLocale);
    if (savedLocale) setLocaleState(savedLocale);
  }

  useEffect(() => {
    document.cookie = localeCookie(locale);
    document.documentElement.lang = localeTags[locale];
  }, [locale]);

  const signedIn = session !== null;
  const setLocale = useCallback(
    async (next: Locale) => {
      const previous = locale;
      setLocaleState(next);
      if (!signedIn) return true;

      const response = await fetch("/api/account/locale", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      }).catch(() => null);

      if (!response?.ok) {
        setLocaleState(previous);
        return false;
      }
      window.dispatchEvent(new Event("shiftline-session-changed"));
      return true;
    },
    [locale, signedIn],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, messages: getMessages(locale), setLocale }),
    [locale, setLocale],
  );

  const needsLanguageChoice = session !== null && session.user.locale === null;

  return (
    <LocaleContext.Provider value={value}>
      {children}
      {needsLanguageChoice && <LanguagePrompt />}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}

/**
 * One-time chooser for accounts that have no saved locale yet. It cannot be
 * dismissed: a choice must be saved first.
 */
function LanguagePrompt() {
  const { locale, messages, setLocale } = useLocale();
  const [choice, setChoice] = useState<Locale>(locale);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleContinue() {
    setSaving(true);
    setFailed(false);
    const ok = await setLocale(choice);
    if (!ok) {
      setSaving(false);
      setFailed(true);
    }
  }

  return (
    <ModalDialog
      open
      labelledBy="language-prompt-title"
      onOpenChange={() => {}}
    >
      <div className="dialog-panel confirm-dialog-panel">
        <header className="dialog-header confirm-dialog-header">
          <div>
            <h2 id="language-prompt-title">
              {messages.common.languageModalTitle}
            </h2>
            <p className="confirm-dialog-description">
              {messages.common.languageModalBody}
            </p>
          </div>
        </header>
        <div className="language-choice-list" role="radiogroup">
          {locales.map((code) => (
            <button
              key={code}
              aria-checked={choice === code}
              className={`btn btn-lg ${choice === code ? "btn-primary" : "btn-secondary"}`}
              disabled={saving}
              role="radio"
              type="button"
              onClick={() => setChoice(code)}
            >
              {localeNames[code]}
            </button>
          ))}
        </div>
        {failed && (
          <p className="form-error" role="alert">
            {messages.common.languageSaveFailed}
          </p>
        )}
        <div className="confirm-dialog-actions">
          <button
            className="btn btn-primary btn-lg"
            disabled={saving}
            type="button"
            onClick={() => void handleContinue()}
          >
            {saving
              ? messages.common.languageModalSaving
              : messages.common.languageModalContinue}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
