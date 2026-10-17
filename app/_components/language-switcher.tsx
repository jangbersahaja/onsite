"use client";

import { useLocale } from "@/app/_components/locale-provider";
import { isLocale, localeNames, locales } from "@/lib/i18n/config";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, messages, setLocale } = useLocale();

  return (
    <select
      aria-label={messages.common.languageSwitchLabel}
      className={`language-switcher ${className ?? ""}`}
      value={locale}
      onChange={(event) => {
        const next = event.target.value;
        if (isLocale(next)) void setLocale(next);
      }}
    >
      {locales.map((code) => (
        <option key={code} value={code}>
          {localeNames[code]}
        </option>
      ))}
    </select>
  );
}
