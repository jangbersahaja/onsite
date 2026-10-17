import type { Locale } from "../config";
import { enAuth } from "./en/auth";
import { enClock } from "./en/clock";
import { en as enCommon } from "./en/common";
import { enDialogs } from "./en/dialogs";
import { enErrors } from "./en/errors";
import { enHistory } from "./en/history";
import { enShell } from "./en/shell";
import { idAuth } from "./id/auth";
import { idClock } from "./id/clock";
import { id as idCommon } from "./id/common";
import { idDialogs } from "./id/dialogs";
import { idErrors } from "./id/errors";
import { idHistory } from "./id/history";
import { idShell } from "./id/shell";
import { msAuth } from "./ms/auth";
import { msClock } from "./ms/clock";
import { ms as msCommon } from "./ms/common";
import { msDialogs } from "./ms/dialogs";
import { msErrors } from "./ms/errors";
import { msHistory } from "./ms/history";
import { msShell } from "./ms/shell";

export type Messages = {
  common: typeof enCommon;
  auth: typeof enAuth;
  errors: typeof enErrors;
  clock: typeof enClock;
  history: typeof enHistory;
  dialogs: typeof enDialogs;
  shell: typeof enShell;
};

const dictionaries: Record<Locale, Messages> = {
  en: {
    common: enCommon,
    auth: enAuth,
    errors: enErrors,
    clock: enClock,
    history: enHistory,
    dialogs: enDialogs,
    shell: enShell,
  },
  ms: {
    common: msCommon,
    auth: msAuth,
    errors: msErrors,
    clock: msClock,
    history: msHistory,
    dialogs: msDialogs,
    shell: msShell,
  },
  id: {
    common: idCommon,
    auth: idAuth,
    errors: idErrors,
    clock: idClock,
    history: idHistory,
    dialogs: idDialogs,
    shell: idShell,
  },
};

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}
