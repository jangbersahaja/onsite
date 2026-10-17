export const locales = ["en", "ms", "id"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";
export const localeCookieName = "onsite-locale";
export const localeCookieMaxAge = 60 * 60 * 24 * 365;

export const localeNames: Record<Locale, string> = {
  en: "English",
  ms: "Bahasa Melayu",
  id: "Bahasa Indonesia",
};

export const localeTags: Record<Locale, string> = {
  en: "en-SG",
  ms: "ms-MY",
  id: "id-ID",
};

export function localeCookie(locale: Locale) {
  return `${localeCookieName}=${locale}; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax`;
}

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (locales as readonly string[]).includes(value)
  );
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : defaultLocale;
}
