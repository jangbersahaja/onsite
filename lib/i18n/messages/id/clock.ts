import type { enClock } from "../en/clock";

export const idClock: typeof enClock = {
  pageTitle: "Absensi",
  workspaceFallback: "Manajemen waktu",
  loading: {
    app: "Memuat OnSITE…",
    backoffice: "Membuka Backoffice…",
    timekeeping: "Memuat data waktu kerja Anda…",
  },
  navigation: {
    myTime: "WAKTU SAYA",
    clock: "Absensi",
    history: "Riwayat",
    workspace: "KELOLA",
    backoffice: "Backoffice",
  },
  status: {
    onBreak: "SEDANG ISTIRAHAT",
    shiftInProgress: "SHIFT BERJALAN",
    readyToStart: "SIAP MULAI",
    started: "Mulai",
    worked: "Waktu kerja",
    onBreakLabel: "Sedang istirahat",
  },
  duration: "{hours}j {minutes}m",
  breakTotal: "{duration} istirahat",
  inProgress: "Sedang berjalan",
  timeIn: "Masuk",
  timeOut: "Keluar",
  shifts: {
    heading: "Shift terbaru",
    viewAll: "Lihat semua shift",
    empty:
      "Belum ada shift. Catatan absen masuk dan keluar Anda akan muncul di sini setelah shift pertama.",
    detailsLabel: "Detail absensi dan shift",
  },
  actions: {
    clockIn: "Absen masuk",
    clockOut: "Absen keluar",
    manualClockIn: "Absen masuk manual",
    manualClockOut: "Absen keluar manual",
    resumeShift: "Lanjutkan shift",
    checkingLocation: "Memeriksa lokasi…",
    resuming: "Melanjutkan…",
    startBreak: "Mulai istirahat",
    endBreak: "Akhiri istirahat",
    savingBreak: "Menyimpan istirahat…",
    requesting: "Mengajukan…",
    requestThisBrowser: "Ajukan browser ini",
    checkEnrollment: "Periksa pengajuan pendaftaran",
    checkPending: "Periksa pengajuan tertunda",
    requestEnrollment: "Ajukan pendaftaran perangkat",
    retryLocation: "Coba lagi lokasi",
  },
  nextStep: {
    device: "Berikutnya: setujui browser ini agar bisa absen.",
    gps: "Berikutnya: tunggu akurasi GPS 50 m atau lebih baik, atau mendekat ke outlet.",
  },
  timezoneNotice: "Waktu ditampilkan sesuai zona waktu outlet ({timezone}).",
  confirm: {
    clockInTitle: "Absen masuk sekarang?",
    clockOutTitle: "Absen keluar sekarang?",
    clockDescription:
      "Lokasi Anda akan diperiksa dan dicatat bersama tindakan ini.",
    breakStartTitle: "Mulai istirahat sekarang?",
    breakEndTitle: "Akhiri istirahat sekarang?",
    breakDescription: "Lokasi Anda akan dicatat bersama tindakan ini.",
    deviceTitle: "Ajukan persetujuan perangkat?",
    deviceDescription:
      "Manajer harus menyetujui browser ini sebelum Anda dapat absen masuk atau keluar.",
    deviceConfirm: "Ajukan persetujuan",
  },
  checks: {
    gps: "GPS",
    device: "Perangkat",
    gpsReady: "GPS siap",
    gpsChecking: "Memeriksa GPS…",
    gpsImprovingTitle: "Meningkatkan akurasi GPS…",
    noOutletTitle: "Belum ada outlet yang ditugaskan",
    noOutletDetail:
      "Minta manajer Anda menambahkan Anda ke outlet aktif sebelum absen.",
    unavailableTitle: "Waktu kerja tidak tersedia",
    unavailableDetail:
      "Data absensi Anda tidak dapat dimuat. Muat ulang halaman atau hubungi manajer Anda.",
    accuracyLowTitle: "Akurasi GPS terlalu rendah",
    accuracyServerDetail:
      "Server mengukur ±{accuracy} m; harus 50 m atau lebih baik. Dekat jendela atau di luar ruangan, lalu coba lagi.",
    accuracyLiveDetail:
      "Akurasi ±{accuracy} m; harus 50 m atau lebih baik. Menunggu sinyal yang lebih kuat…",
    outsideTitle: "Di luar area absensi",
    outsideServerDetail: "{distance} m dari outlet; batasnya {radius} m.",
    outsideLiveDetail:
      "Sekitar {distance} m melewati radius outlet {radius} m.",
    permissionTitle: "Akses lokasi nonaktif",
    permissionDetail:
      "Aktifkan akses lokasi di pengaturan browser Anda, lalu coba lagi.",
    noLocationTitle: "Lokasi tidak andal",
    noLocationDetail:
      "Dekati jendela atau coba lagi saat ponsel Anda mendapat sinyal GPS yang jelas.",
    browserCheckingTitle: "Memeriksa browser…",
    browserCheckingDetail:
      "Tindakan absensi tetap terkunci sampai persetujuan browser ini terverifikasi.",
    browserApprovedTitle: "Browser disetujui",
    replacementReview: "Pengajuan penggantian sedang ditinjau manajer.",
    awaitingTitle: "Menunggu persetujuan manajer",
    awaitingThisBrowser: "Browser ini sedang menunggu persetujuan manajer.",
    awaitingOther:
      "Pengajuan perangkat sudah menunggu persetujuan. Tanyakan manajer Anda jika Anda perlu menggantinya.",
    notApprovedTitle: "Browser belum disetujui",
    notApprovedDetail: "Ajukan persetujuan untuk browser ini sebelum absen.",
  },
  notices: {
    browserNotApproved:
      "Browser ini belum disetujui untuk tindakan absensi. Daftarkan browser ini dan minta manajer Anda untuk menyetujuinya.",
    locationUnavailable:
      "Lokasi tidak tersedia. Minta kepala outlet Anda untuk meninjau waktu Anda.",
    checkingLocation: "Memeriksa lokasi Anda…",
    recordingAction: "Mencatat tindakan absensi Anda…",
    refreshingShift: "Memuat ulang shift Anda…",
    refreshFailed:
      "Tindakan absensi tercatat, tetapi shift Anda tidak dapat dimuat ulang. Muat ulang halaman untuk melihat status terkini Anda.",
    recordUnconfirmed:
      "Tindakan absensi belum dapat dikonfirmasi oleh layanan waktu kerja. Muat ulang halaman untuk memeriksa shift Anda sebelum mencoba lagi.",
    recordFailed: "Tindakan absensi tidak dapat dicatat.",
    locationCheckFailed: "Lokasi Anda tidak dapat diperiksa. Coba lagi.",
    locationTimedOut:
      "Pemeriksaan lokasi habis waktu setelah 30 detik. Periksa izin lokasi browser Anda, dekati jendela, lalu coba lagi.",
    locationPermissionDenied:
      "Izin lokasi ditolak. Aktifkan akses lokasi di pengaturan browser Anda, lalu coba lagi.",
    locationUnreliable:
      "Kami tidak dapat memperoleh lokasi yang andal. Dekati jendela dan coba lagi, atau ajukan koreksi waktu.",
    startingBreak: "Memulai istirahat Anda…",
    endingBreak: "Mengakhiri istirahat Anda…",
    breakFailed: "Tindakan istirahat gagal.",
    loadFailed: "Data waktu kerja tidak dapat dimuat.",
    correctionHistoryUnavailable:
      "Riwayat koreksi tidak dapat dimuat. Absensi GPS yang terverifikasi tetap tersedia; koreksi manual mungkin tidak tersedia.",
    deviceVerifyFailed:
      "Persetujuan browser ini tidak dapat diverifikasi. Muat ulang halaman atau hubungi manajer Anda; absensi dinonaktifkan sampai terverifikasi.",
    deviceRequestFailed: "Perangkat ini tidak dapat diajukan.",
    deviceAlreadyApproved: "Browser ini sudah disetujui untuk akun Anda.",
    deviceReplacementAwaiting:
      "Pengajuan penggantian sedang menunggu persetujuan manajer.",
    deviceEnrollmentAwaiting:
      "Pengajuan pendaftaran perangkat sedang menunggu persetujuan manajer.",
  },
};
