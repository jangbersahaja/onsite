import type { enClock } from "../en/clock";

export const msClock: typeof enClock = {
  pageTitle: "Kehadiran",
  workspaceFallback: "Pengurusan masa",
  loading: {
    app: "Memuatkan OnSITE…",
    backoffice: "Membuka Backoffice…",
    timekeeping: "Memuatkan data kehadiran anda…",
  },
  navigation: {
    myTime: "MASA SAYA",
    clock: "Kehadiran",
    history: "Sejarah",
    workspace: "URUS",
    backoffice: "Backoffice",
  },
  status: {
    onBreak: "SEDANG REHAT",
    shiftInProgress: "SHIF SEDANG BERJALAN",
    readyToStart: "SEDIA UNTUK MULA",
    started: "Mula",
    worked: "Masa bekerja",
    onBreakLabel: "Sedang rehat",
  },
  duration: "{hours}j {minutes}m",
  breakTotal: "{duration} rehat",
  inProgress: "Sedang berjalan",
  timeIn: "Masuk",
  timeOut: "Keluar",
  shifts: {
    heading: "Shif terkini",
    viewAll: "Lihat semua shif",
    empty:
      "Tiada shif lagi. Rekod masuk dan keluar anda akan dipaparkan di sini selepas shif pertama.",
    detailsLabel: "Butiran kehadiran dan shif",
  },
  actions: {
    clockIn: "Daftar masuk",
    clockOut: "Daftar keluar",
    manualClockIn: "Daftar masuk manual",
    manualClockOut: "Daftar keluar manual",
    resumeShift: "Sambung shif",
    checkingLocation: "Menyemak lokasi…",
    resuming: "Menyambung…",
    startBreak: "Mula rehat",
    endBreak: "Tamat rehat",
    savingBreak: "Menyimpan rehat…",
    requesting: "Memohon…",
    requestThisBrowser: "Mohon peranti ini",
    checkEnrollment: "Semak permohonan pendaftaran",
    checkPending: "Semak permohonan tertunda",
    requestEnrollment: "Mohon pendaftaran peranti",
    retryLocation: "Cuba semula lokasi",
  },
  nextStep: {
    device: "Seterusnya: lulus browser ini untuk membolehkan kehadiran.",
    gps: "Seterusnya: tunggu ketepatan GPS 50 m atau kurang, atau dekati outlet.",
  },
  timezoneNotice: "Masa dipaparkan mengikut masa outlet ({timezone}).",
  confirm: {
    clockInTitle: "Daftar masuk sekarang?",
    clockOutTitle: "Daftar keluar sekarang?",
    clockDescription:
      "Lokasi anda akan disemak dan direkodkan bersama tindakan ini.",
    breakStartTitle: "Mula rehat sekarang?",
    breakEndTitle: "Tamat rehat sekarang?",
    breakDescription: "Lokasi anda akan direkodkan bersama tindakan ini.",
    deviceTitle: "Mohon kelulusan peranti?",
    deviceDescription:
      "Pengurus mesti meluluskan peranti ini sebelum anda boleh mendaftar masuk atau keluar.",
    deviceConfirm: "Mohon kelulusan",
  },
  checks: {
    gps: "GPS",
    device: "Peranti",
    gpsReady: "GPS sedia",
    gpsChecking: "Menyemak GPS…",
    gpsImprovingTitle: "Menambah baik ketepatan GPS…",
    noOutletTitle: "Tiada outlet diberikan",
    noOutletDetail:
      "Minta pengurus anda menambah anda ke outlet aktif sebelum mendaftar masuk.",
    unavailableTitle: "Kehadiran tidak tersedia",
    unavailableDetail:
      "Data kehadiran anda tidak dapat dimuatkan. Muat semula halaman atau hubungi pengurus anda.",
    accuracyLowTitle: "Ketepatan GPS terlalu rendah",
    accuracyServerDetail:
      "Pelayan mengukur ±{accuracy} m; ia mesti 50 m atau kurang. Bergerak berdekatan tingkap atau di luar, kemudian cuba lagi.",
    accuracyLiveDetail:
      "Ketepatan ±{accuracy} m; ia mesti 50 m atau kurang. Menunggu isyarat yang lebih kuat…",
    outsideTitle: "Di luar kawasan daftar masuk",
    outsideServerDetail: "{distance} m dari outlet; had ialah {radius} m.",
    outsideLiveDetail:
      "Kira-kira {distance} m melebihi jejari outlet {radius} m.",
    permissionTitle: "Akses lokasi dimatikan",
    permissionDetail:
      "Dayakan akses lokasi dalam tetapan pelayar anda, kemudian cuba lagi.",
    noLocationTitle: "Lokasi tidak boleh dipercayai",
    noLocationDetail:
      "Dekati tingkap atau cuba semula apabila telefon anda mempunyai isyarat GPS yang jelas.",
    browserCheckingTitle: "Menyemak peranti…",
    browserCheckingDetail:
      "Tindakan kehadiran kekal dikunci sehingga kelulusan peranti ini disahkan.",
    browserApprovedTitle: "Peranti diluluskan",
    replacementReview: "Permohonan penggantian sedang disemak oleh pengurus.",
    awaitingTitle: "Menunggu kelulusan pengurus",
    awaitingThisBrowser: "Peranti ini sedang menunggu kelulusan pengurus.",
    awaitingOther:
      "Permohonan peranti sudah menunggu kelulusan. Tanya pengurus anda jika anda perlu menggantikannya.",
    notApprovedTitle: "Peranti tidak diluluskan",
    notApprovedDetail:
      "Mohon kelulusan untuk peranti ini sebelum mendaftar masuk.",
  },
  notices: {
    browserNotApproved:
      "Peranti ini tidak diluluskan untuk tindakan kehadiran. Daftarkan peranti ini dan minta pengurus anda meluluskannya.",
    locationUnavailable:
      "Lokasi tidak tersedia. Minta ketua outlet anda menyemak masa anda.",
    checkingLocation: "Menyemak lokasi anda…",
    recordingAction: "Merekodkan tindakan kehadiran anda…",
    refreshingShift: "Memuat semula shif anda…",
    refreshFailed:
      "Tindakan kehadiran direkodkan, tetapi shif anda tidak dapat dimuat semula. Muat semula halaman untuk melihat status semasa anda.",
    recordUnconfirmed:
      "Tindakan kehadiran tidak dapat disahkan dengan perkhidmatan kehadiran. Muat semula halaman untuk menyemak shif anda sebelum mencuba lagi.",
    recordFailed: "Tindakan kehadiran tidak dapat direkodkan.",
    locationCheckFailed: "Lokasi anda tidak dapat disemak. Cuba lagi.",
    locationTimedOut:
      "Semakan lokasi tamat masa selepas 30 saat. Semak kebenaran lokasi pelayar anda, dekati tingkap, kemudian cuba lagi.",
    locationPermissionDenied:
      "Kebenaran lokasi ditolak. Dayakan akses lokasi dalam tetapan pelayar anda, kemudian cuba lagi.",
    locationUnreliable:
      "Lokasi yang boleh dipercayai tidak dapat diperoleh. Dekati tingkap dan cuba lagi, atau mohon pembetulan masa.",
    startingBreak: "Memulakan rehat anda…",
    endingBreak: "Menamatkan rehat anda…",
    breakFailed: "Tindakan rehat gagal.",
    loadFailed: "Data kehadiran tidak dapat dimuatkan.",
    correctionHistoryUnavailable:
      "Sejarah pembetulan tidak dapat dimuatkan. Daftar masuk GPS yang disahkan kekal tersedia; pembetulan manual mungkin tidak tersedia.",
    deviceVerifyFailed:
      "Kelulusan peranti ini tidak dapat disahkan. Muat semula halaman atau hubungi pengurus anda; kehadiran dilumpuhkan sehingga disahkan.",
    deviceRequestFailed: "Peranti ini tidak dapat dimohon.",
    deviceAlreadyApproved: "Peranti ini sudah diluluskan untuk akaun anda.",
    deviceReplacementAwaiting:
      "Permohonan penggantian sedang menunggu kelulusan pengurus.",
    deviceEnrollmentAwaiting:
      "Permohonan pendaftaran peranti sedang menunggu kelulusan pengurus.",
  },
};
