export const enHistory = {
  nav: {
    groupMyTime: "MY TIME",
    groupWorkspace: "WORKSPACE",
    clock: "Clock",
    history: "History",
    backoffice: "Backoffice",
  },
  page: {
    eyebrow: "MY TIME",
    title: "History",
    subheading: "Your recorded shifts and time requests.",
    fallbackWorkspaceName: "Timekeeping",
  },
  actions: {
    requestCorrection: "Request correction",
    loadMore: "Load more shifts",
    loadingMore: "Loading…",
  },
  tabs: {
    label: "History views",
    shifts: "Shifts",
    requests: "Requests",
  },
  filters: {
    month: "Month",
  },
  manualShift: {
    addShift: "Add past shift",
    title: "Add a past shift",
    description:
      "For a shift you worked but never clocked. A manager at this outlet will review it before it appears in your history.",
    outlet: "Outlet",
    submit: "Submit for review",
    submitting: "Submitting…",
    confirmTitle: "Submit this past shift?",
    confirmDescription:
      "A manager at this outlet will review it. Your history does not change until it is approved.",
    confirmLabel: "Submit request",
    fallbackError: "Could not submit the request.",
    pastShift: "Past shift",
    closeLabel: "Close past shift request",
    closeTitle: "Close",
    status: {
      pending: "Waiting for review",
      approved: "Approved",
      rejected: "Rejected",
    },
  },
  summary: {
    allOutlets: "All outlets",
    workedHours: "worked hours in loaded shifts",
  },
  aria: {
    shifts: "Recorded shifts",
    requests: "Correction requests",
  },
  shift: {
    clockIn: "Clock in",
    clockOut: "Clock out",
    inProgress: "In progress",
    grossDuration: "{duration} gross · ",
    breakDuration: "{duration} break",
  },
  request: {
    clockIn: "Clock-in",
    clockOut: "Clock-out",
    review: "Review: {reason}",
  },
  status: {
    reconciliation: "Needs reconciliation",
    approved: "Approved",
    rejected: "Rejected",
  },
  states: {
    loadingHistory: "Loading your history…",
    openingBackoffice: "Opening Backoffice…",
    loadingShifts: "Loading shifts…",
    noShifts: "No shifts recorded for this month.",
    noRequests: "No correction requests for this outlet.",
  },
  errors: {
    loadFailed: "Could not load shift history.",
  },
  units: {
    hoursMinutes: "{hours}h {minutes}m",
  },
};
