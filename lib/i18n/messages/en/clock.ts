export const enClock = {
  pageTitle: "Clock",
  workspaceFallback: "Timekeeping",
  loading: {
    app: "Loading OnSITE…",
    backoffice: "Opening Backoffice…",
    timekeeping: "Loading your timekeeping data…",
  },
  navigation: {
    myTime: "MY TIME",
    clock: "Clock",
    history: "History",
    workspace: "WORKSPACE",
    backoffice: "Backoffice",
  },
  status: {
    onBreak: "ON BREAK",
    shiftInProgress: "SHIFT IN PROGRESS",
    readyToStart: "READY TO START",
    started: "Started",
    worked: "Worked",
    onBreakLabel: "On break",
  },
  duration: "{hours}h {minutes}m",
  breakTotal: "{duration} break",
  inProgress: "In progress",
  timeIn: "In",
  timeOut: "Out",
  shifts: {
    heading: "Recent shifts",
    viewAll: "View all shifts",
    empty: "No clock records yet.",
    detailsLabel: "Clock and shift details",
  },
  actions: {
    clockIn: "Clock in",
    clockOut: "Clock out",
    manualClockIn: "Manual clock in",
    manualClockOut: "Manual clock out",
    resumeShift: "Resume shift",
    checkingLocation: "Checking location…",
    resuming: "Resuming…",
    startBreak: "Start break",
    endBreak: "End break",
    savingBreak: "Saving break…",
    requesting: "Requesting…",
    requestThisBrowser: "Request this browser",
    checkEnrollment: "Check enrollment request",
    checkPending: "Check pending request",
    requestEnrollment: "Request device enrollment",
  },
  confirm: {
    clockInTitle: "Clock in now?",
    clockOutTitle: "Clock out now?",
    clockDescription:
      "Your location will be checked and recorded with this action.",
    breakStartTitle: "Start break now?",
    breakEndTitle: "End break now?",
    breakDescription: "Your location will be recorded with this action.",
    deviceTitle: "Request device approval?",
    deviceDescription:
      "A manager must approve this browser before you can clock in or out.",
    deviceConfirm: "Request approval",
  },
  checks: {
    gps: "GPS",
    device: "Device",
    gpsReady: "GPS ready",
    gpsChecking: "Checking GPS…",
    noOutletTitle: "No outlet assigned",
    noOutletDetail:
      "Ask your manager to add you to an active outlet before clocking.",
    unavailableTitle: "Timekeeping unavailable",
    unavailableDetail:
      "Your clock data could not be loaded. Reload the page or contact your manager.",
    accuracyLowTitle: "GPS accuracy too low",
    accuracyServerDetail:
      "Server measured ±{accuracy} m; it must be 50 m or better.",
    accuracyLiveDetail: "Accuracy is ±{accuracy} m; it must be 50 m or better.",
    outsideTitle: "Outside the clocking area",
    outsideServerDetail:
      "{distance} m from the outlet; the limit is {radius} m.",
    outsideLiveDetail:
      "About {distance} m beyond the {radius} m outlet radius.",
    permissionTitle: "Location access is off",
    permissionDetail:
      "Enable location access in your browser settings, then try again.",
    noLocationTitle: "No reliable location",
    noLocationDetail:
      "Move near a window or retry when your phone has a clear GPS signal.",
    browserCheckingTitle: "Checking browser…",
    browserCheckingDetail:
      "Clock actions stay locked until this browser's approval is verified.",
    browserApprovedTitle: "Browser approved",
    replacementReview: "Replacement request is under manager review.",
    awaitingTitle: "Awaiting manager approval",
    awaitingThisBrowser: "This browser is awaiting manager approval.",
    awaitingOther:
      "A device request is already awaiting approval. Ask your manager if you need to replace it.",
    notApprovedTitle: "Browser not approved",
    notApprovedDetail: "Request approval for this browser before clocking.",
  },
  notices: {
    browserNotApproved:
      "This browser is not approved for clock actions. Enroll this browser and ask your manager to approve it.",
    locationUnavailable:
      "Location is unavailable. Ask your outlet lead to review your time.",
    checkingLocation: "Checking your location…",
    recordingAction: "Recording your clock action…",
    refreshingShift: "Refreshing your shift…",
    refreshFailed:
      "Clock action recorded, but your shift could not be refreshed. Reload the page to see your current status.",
    recordUnconfirmed:
      "Could not confirm the clock action with the timekeeping service. Reload the page to check your shift before trying again.",
    recordFailed: "Clock action could not be recorded.",
    locationCheckFailed: "Could not check your location. Try again.",
    locationTimedOut:
      "Location check timed out after 30 seconds. Check your browser's location permission, move near a window, then try again.",
    locationPermissionDenied:
      "Location permission was denied. Enable location access in your browser settings, then try again.",
    locationUnreliable:
      "We could not get a reliable location. Move near a window and try again, or request a time correction.",
    startingBreak: "Starting your break…",
    endingBreak: "Ending your break…",
    breakFailed: "Break action failed.",
    loadFailed: "Could not load timekeeping data.",
    correctionHistoryUnavailable:
      "Correction history could not be loaded. Verified GPS clocking remains available; manual corrections may be unavailable.",
    deviceVerifyFailed:
      "Could not verify this browser’s approval. Reload the page or contact your manager; clocking is disabled until verified.",
    deviceRequestFailed: "Could not request this device.",
    deviceAlreadyApproved: "This browser is already approved for your account.",
    deviceReplacementAwaiting:
      "Replacement request is awaiting manager approval.",
    deviceEnrollmentAwaiting:
      "Device enrollment request is awaiting manager approval.",
  },
};
