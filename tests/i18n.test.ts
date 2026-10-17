import {
  isLocale,
  localeCookie,
  localeCookieMaxAge,
  localeCookieName,
  localeNames,
  localeTags,
  locales,
  resolveLocale,
} from "@/lib/i18n/config";
import { errorMessage } from "@/lib/i18n/errors";
import { format } from "@/lib/i18n/format";
import { getMessages } from "@/lib/i18n/messages";
import assert from "node:assert/strict";
import test from "node:test";

function keysOf(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? keysOf(child, path)
      : [path];
  });
}

test("every locale has the same message keys as English", () => {
  const english = getMessages("en");
  for (const locale of locales) {
    const messages = getMessages(locale);
    for (const namespace of ["common", "auth", "errors"] as const) {
      assert.deepEqual(
        keysOf(messages[namespace]).sort(),
        keysOf(english[namespace]).sort(),
        `${locale}.${namespace} keys differ from en`,
      );
    }
  }
});

test("no message value is empty in any locale", () => {
  for (const locale of locales) {
    const messages = getMessages(locale);
    for (const namespace of ["common", "auth", "errors"] as const) {
      for (const path of keysOf(messages[namespace])) {
        const value = path
          .split(".")
          .reduce<unknown>(
            (node, key) => (node as Record<string, unknown>)[key],
            messages[namespace],
          );
        assert.equal(
          typeof value === "string" && value.trim().length > 0,
          true,
          `${locale}.${namespace}.${path} is empty`,
        );
      }
    }
  }
});

test("format replaces named placeholders and keeps unknown ones", () => {
  assert.equal(
    format("Registering for {outlet}.", { outlet: "Kopitiam" }),
    "Registering for Kopitiam.",
  );
  assert.equal(format("{a} and {a}", { a: 2 }), "2 and 2");
  assert.equal(format("Hello {missing}", {}), "Hello {missing}");
});

test("resolveLocale falls back to English for unknown values", () => {
  assert.equal(resolveLocale("ms"), "ms");
  assert.equal(resolveLocale("id"), "id");
  assert.equal(resolveLocale("fr"), "en");
  assert.equal(resolveLocale(undefined), "en");
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("EN"), false);
});

test("locale tags and names cover every locale", () => {
  assert.deepEqual(localeTags, { en: "en-SG", ms: "ms-MY", id: "id-ID" });
  assert.deepEqual(localeNames, {
    en: "English",
    ms: "Bahasa Melayu",
    id: "Bahasa Indonesia",
  });
});

test("localeCookie writes the cookie with the expected attributes", () => {
  assert.equal(localeCookieName, "onsite-locale");
  assert.equal(
    localeCookie("ms"),
    `onsite-locale=ms; Path=/; Max-Age=${localeCookieMaxAge}; SameSite=Lax`,
  );
});

test("errorMessage translates known codes and falls back to the text", () => {
  const english = getMessages("en");
  const malay = getMessages("ms");
  assert.equal(
    errorMessage(english, { code: "invalid_sign_in", text: "server text" }),
    english.errors.invalid_sign_in,
  );
  assert.equal(
    errorMessage(malay, { code: "invalid_sign_in", text: "server text" }),
    malay.errors.invalid_sign_in,
  );
  assert.equal(
    errorMessage(english, { code: "not_a_real_code", text: "server text" }),
    "server text",
  );
  assert.equal(errorMessage(english, { code: null, text: "plain" }), "plain");
});
